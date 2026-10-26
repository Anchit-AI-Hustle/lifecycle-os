// Sign in with an AI provider's own account (2026-10-24).
//
// The operator: "while user is using his keys for the AI models also allow him
// to sign in directly with that AI model to be able to use his own account."
// Only a provider that documents a sign-in a third-party web app may use is
// offered: OpenRouter's OAuth PKCE (https://openrouter.ai/docs/use-cases/oauth-pkce),
// whose one-time code is exchanged for a key on the person's own account.
// OpenAI, Anthropic and Gemini say why they have none.
//
// Executed: the shipped connections router (workspace-connections-core.handle)
// over the fake project, OpenRouter's exchange answered by the fake (anything
// else unrouted throws); the page in Chromium for the redirect and the return.
//
// Run: npx playwright test tests/ai-account-signin.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { FakeSupabase, makeReq, makeRes, envScope, response, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');

const ROOT = path.resolve(__dirname, '..');
const connections = require(path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js'));
const signin = require(path.join(ROOT, 'api', '_shared', 'ai-account-signin.js'));
const EXCHANGE = 'https://openrouter.ai/api/v1/auth/keys';
const VERIFIER = 'v'.repeat(43) + 'erifier-0123456789';

const ENV = envScope(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'CONNECTION_SECRET_KEY', 'GOOGLE_AI_OAUTH_CLIENT_ID', 'GOOGLE_AI_OAUTH_CLIENT_SECRET']);
let REAL_FETCH;
test.beforeAll(() => {
  ENV.save(); REAL_FETCH = global.fetch;
  process.env.SUPABASE_URL = BASE; process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY; process.env.CONNECTION_SECRET_KEY = 'e'.repeat(64);
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'GOOGLE_AI_OAUTH_CLIENT_ID', 'GOOGLE_AI_OAUTH_CLIENT_SECRET']) delete process.env[k];
});
const GOOGLE_ID = '123-test.apps.googleusercontent.com';
function withGoogleClient(on) {
  if (on) { process.env.GOOGLE_AI_OAUTH_CLIENT_ID = GOOGLE_ID; process.env.GOOGLE_AI_OAUTH_CLIENT_SECRET = 'google-client-secret'; }
  else { delete process.env.GOOGLE_AI_OAUTH_CLIENT_ID; delete process.env.GOOGLE_AI_OAUTH_CLIENT_SECRET; }
}
test.afterAll(() => { ENV.restore(); global.fetch = REAL_FETCH; });

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
function openrouterAnswers(db, answer) {
  const seen = [];
  db.route((u) => u === EXCHANGE, (_u, _i, c) => { seen.push(c); return typeof answer === 'function' ? answer(c) : answer; });
  return seen;
}

test('the registry offers OpenRouter sign-in and says why OpenAI, Anthropic and Gemini have none', async () => {
  const db = world();
  const r = await call('tok-a', 'registry');
  expect(r.code).toBe(200);
  const by = Object.fromEntries(r.payload.providers.map((p) => [p.id, p]));
  expect(by.openrouter.signin).toMatchObject({ available: true, kind: 'pkce', authorize_url: 'https://openrouter.ai/auth' });
  for (const id of ['openai', 'anthropic', 'gemini', 'grok']) {
    expect(by[id].signin.available, id).toBe(false);
    expect(by[id].signin.note, id).toMatch(/create a key on your account/);
  }
  // A non-AI platform carries no sign-in field at all.
  expect(Object.values(by).filter((p) => p.category !== 'ai').every((p) => p.signin == null)).toBe(true);
  db.uninstall && db.uninstall();
});

test('a sign-in code is exchanged with its verifier, and the key is kept encrypted for the workspace, never returned', async () => {
  const db = world();
  const seen = openrouterAnswers(db, { key: 'sk-or-v1-PERSONALKEY1234' });
  const r = await call('tok-a', 'ai-signin-exchange', { provider: 'openrouter', code: 'code-123', code_verifier: VERIFIER });
  expect(r.code, JSON.stringify(r.payload)).toBe(200);
  expect(r.payload).toMatchObject({ ok: true, provider: 'openrouter', signed_in: true });
  expect(JSON.stringify(r.payload)).not.toContain('PERSONALKEY');
  expect(seen).toHaveLength(1);
  expect(seen[0].method).toBe('POST');
  expect(seen[0].body).toEqual({ code: 'code-123', code_verifier: VERIFIER, code_challenge_method: 'S256' });
  const conn = db.table('workspace_connections').find((x) => x.provider === 'openrouter');
  expect(conn).toMatchObject({ workspace_id: 'ws-a', label: 'OpenRouter (signed in)', secret_hint: '1234' });
  const sec = db.table('workspace_connection_secrets').find((x) => x.connection_id === conn.id);
  expect(JSON.stringify(sec)).not.toContain('PERSONALKEY');            // ciphertext only
  expect(connections.decryptSecrets(sec).api_key).toBe('sk-or-v1-PERSONALKEY1234');
});

test('Claude, ChatGPT, Gemini and Grok cards send the person to THAT provider\'s own sign-in, never through OpenRouter', async () => {
  // 2026-10-24, the operator: "use each respective model signup not openrouter
  // as common for all". Each card points at its own provider's key page.
  const reg = connections.registryView(true);
  const by = Object.fromEntries(reg.map((p) => [p.id, p]));
  const own = { anthropic: 'https://console.anthropic.com/settings/keys', openai: 'https://platform.openai.com/api-keys', gemini: 'https://aistudio.google.com/apikey', grok: 'https://console.x.ai' };
  for (const id of Object.keys(own)) {
    expect(by[id].signin.provider_signin, id).toMatchObject({ url: own[id] });
    expect(JSON.stringify(by[id].signin), id).not.toMatch(/openrouter/i);
  }
  expect(by.openai.signin.note).toMatch(/Sign in with ChatGPT.*limited trial/);
  // A model the OpenRouter card's model field names is what generation asks for.
  const conn = { id: 'c1', provider: 'openrouter', status: 'active', config: { model: 'anthropic/claude-sonnet-5.5' } };
  const ov = connections.buildOverrides(null, [conn], new Map([['c1', { api_key: 'sk-or-v1-X' }]]));
  expect(ov.models.openrouter).toEqual(['anthropic/claude-sonnet-5.5']);
  const ov2 = connections.buildOverrides({ entries: [{ provider: 'openrouter', models: ['openai/gpt-4o'] }] }, [conn], new Map());
  expect(ov2.models.openrouter).toEqual(['openai/gpt-4o']);
});

test('a viewer cannot keep a key, so nothing is exchanged; a refused or missing code says to start again', async () => {
  let db = world();
  let seen = openrouterAnswers(db, { key: 'sk-or-v1-x' });
  const viewer = await call('tok-v', 'ai-signin-exchange', { provider: 'openrouter', code: 'c', code_verifier: VERIFIER });
  expect(viewer.code).toBeGreaterThanOrEqual(400);
  expect(seen, 'the code was spent for a caller who cannot keep the key').toHaveLength(0);

  db = world();
  seen = openrouterAnswers(db, () => response(400, { error: { message: 'Invalid code' } }));
  const refused = await call('tok-a', 'ai-signin-exchange', { provider: 'openrouter', code: 'used', code_verifier: VERIFIER });
  expect(refused.code).toBe(400);
  expect(refused.payload.message).toMatch(/single-use and expires after 10 minutes/);
  expect(refused.payload.message).not.toMatch(/Invalid code/);
  expect(db.table('workspace_connections').length).toBe(0);

  const noCode = await call('tok-a', 'ai-signin-exchange', { provider: 'openrouter', code: '', code_verifier: VERIFIER });
  expect(noCode.code).toBe(400);
  const badVerifier = await call('tok-a', 'ai-signin-exchange', { provider: 'openrouter', code: 'c', code_verifier: 'short' });
  expect(badVerifier.code).toBe(400);
  const notOffered = await call('tok-a', 'ai-signin-exchange', { provider: 'openai', code: 'c', code_verifier: VERIFIER });
  expect(notOffered.code).toBe(400);
  expect(notOffered.payload.message).toMatch(/Sign in at OpenAI, create a key/);
  const anon = await call('', 'ai-signin-exchange', { provider: 'openrouter', code: 'c', code_verifier: VERIFIER });
  expect(anon.code).toBe(401);
});

test('the page starts a PKCE sign-in at OpenRouter and finishes it on return, with the code taken out of the address bar', async ({ page }) => {
  // Each load waits up to 12 s for BrandContext, which this stub page has not.
  test.setTimeout(150000);
  const posts = [];
  let exchanged = false;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const send = (status, type, body) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', Connection: 'close' }); res.end(body); };
    if (u.pathname === '/auth.js') return send(200, 'text/javascript', 'window.LifecycleAuth={session:{access_token:"session-token"}};window.LifecycleStatus={decide:async function(){return null;}};window.LifecycleFailure={sentence:function(e){return e.message;},html:function(e){return e.message;},show:function(){}};');
    if (u.pathname === '/api/public-config' && u.searchParams.get('action') === 'connections') {
      const op = u.searchParams.get('op');
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (op === 'ai-signin-exchange') { posts.push(JSON.parse(body || '{}')); exchanged = true; return send(200, 'application/json', JSON.stringify({ ok: true, signed_in: true, message: 'Signed in with OpenRouter. This workspace now uses your OpenRouter account; the key is kept encrypted and never shown.' })); }
        const reg = connections.registryView(true).filter((p) => p.category === 'ai');
        const conns = exchanged ? [{ provider: 'openrouter', configured: true, secret_fields: ['api_key'], secret_hint: '1234', config: {} }] : [];
        return send(200, 'application/json', JSON.stringify({ ok: true, workspace_id: 'ws-a', connections: conns, routing: { entries: [], use_platform_fallback: true }, providers: reg, secrets_storage: { encrypted: true, store: true } }));
      });
      return undefined;
    }
    const f = path.join(ROOT, u.pathname === '/' ? 'brand-connections.html' : u.pathname.replace(/^\//, ''));
    if (u.pathname === '/connections') return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(ROOT, 'brand-connections.html')));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return send(200, f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', fs.readFileSync(f));
    return send(404, 'text/plain', 'nf');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
      const u = route.request().url();
      if (u.startsWith('https://openrouter.ai/auth')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>openrouter sign-in</p>' });
      return route.abort('failed');
    });
    await page.goto(`${base}/connections`);
    const btn = page.locator('.conn[data-provider="openrouter"] [data-act="signin"]');
    await expect(btn).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.conn[data-provider="openai"] [data-signin-note]')).toContainText('Sign in at OpenAI, create a key');
    await btn.click();
    await page.waitForURL(/openrouter\.ai\/auth/, { timeout: 30000 });
    const auth = new URL(page.url());
    const cb = new URL(auth.searchParams.get('callback_url'));
    expect(cb.origin).toBe(base);
    expect(cb.searchParams.get('ai_signin')).toBe('openrouter');
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(auth.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const st = auth.searchParams.get('state');
    expect(st).toBeTruthy();
    // OpenRouter sends the person back with a one-time code (and the state).
    await page.goto(`${cb.toString()}&code=one-time-code&state=${encodeURIComponent(st)}`);
    await expect(page.locator('[data-signin-result="ok"]')).toContainText('Signed in with OpenRouter', { timeout: 30000 });
    expect(page.url()).not.toContain('one-time-code');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ provider: 'openrouter', code: 'one-time-code' });
    // The verifier the page sent is the one whose S256 hash it gave OpenRouter.
    const hash = require('crypto').createHash('sha256').update(posts[0].code_verifier).digest('base64url');
    expect(hash).toBe(auth.searchParams.get('code_challenge'));
    // The Claude card sends the person to Anthropic's own sign-in, not OpenRouter.
    const claude = page.locator('.conn[data-provider="anthropic"] [data-provider-signin]');
    await expect(claude).toHaveText('Sign in to Anthropic to get your key');
    expect(await claude.getAttribute('href')).toBe('https://console.anthropic.com/settings/keys');
    expect(await page.locator('.conn[data-provider="anthropic"]').textContent()).not.toMatch(/OpenRouter/);
    // A code that comes back to another tab (no stored verifier) is not used.
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(`${base}/connections?ai_signin=openrouter&code=stray&state=x`);
    await expect(page.locator('[data-signin-result="failed"]')).toContainText('not started from this browser tab', { timeout: 30000 });
    expect(posts).toHaveLength(1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('the module names only documented flows', () => {
  expect(Object.keys(signin.SIGNIN).sort()).toEqual(['gemini', 'openrouter']);
  expect(signin.SIGNIN.gemini.source).toBe('https://ai.google.dev/gemini-api/docs/oauth');
  for (const s of Object.values(signin.SIGNIN)) {
    expect(s.source).toMatch(/^https:\/\//);
    expect(s.authorize_url).toMatch(/^https:\/\//);
    expect(s.exchange_url).toMatch(/^https:\/\//);
  }
});


// 2026-10-24, the operator: "signin must completely integrate the signin to use
// the model - not just open key creation page", then "google sign in or whatever
// signin mode that model accepts". Gemini accepts a Google user's OAuth token.
test('Gemini: Sign in with Google is offered once the platform has its Google client, and not before', () => {
  withGoogleClient(false);
  let by = Object.fromEntries(connections.registryView(true).map((p) => [p.id, p]));
  expect(by.gemini.signin.available).toBe(false);
  expect(by.gemini.signin.provider_signin.url).toBe('https://aistudio.google.com/apikey');
  // The refresh token is never a field the page draws.
  expect(by.gemini.fields.map((f) => f.key)).toEqual(['api_key', 'project']);
  withGoogleClient(true);
  by = Object.fromEntries(connections.registryView(true).map((p) => [p.id, p]));
  expect(by.gemini.signin).toMatchObject({ available: true, kind: 'google', client_id: GOOGLE_ID, authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth', scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language.retriever' });
  expect(JSON.stringify(by.gemini.signin)).not.toContain('google-client-secret');
  withGoogleClient(false);
});

test('Gemini: the Google code is exchanged on the server, the project found and the Gemini API switched on, the token kept encrypted', async () => {
  const db = world();
  withGoogleClient(true);
  const seen = [];
  db.route((u) => u === 'https://oauth2.googleapis.com/token', (_u, _i, c) => { seen.push(c); return { access_token: 'ya29.ACCESS', refresh_token: '1//REFRESHSECRET', expires_in: 3599 }; });
  db.route((u) => u.startsWith('https://cloudresourcemanager.googleapis.com/v1/projects'), () => ({ projects: [{ projectId: 'acme-ai' }, { projectId: 'acme-old' }] }));
  const enabled = [];
  db.route((u) => u.startsWith('https://serviceusage.googleapis.com/'), (u) => { enabled.push(u); return {}; });
  try {
    const r = await call('tok-a', 'ai-signin-exchange', { provider: 'gemini', code: 'g-code', code_verifier: VERIFIER, redirect_uri: 'https://app.example.test/ai-models' });
    expect(r.code, JSON.stringify(r.payload)).toBe(200);
    expect(r.payload).toMatchObject({ ok: true, provider: 'gemini', signed_in: true, project: 'acme-ai' });
    expect(r.payload.message).toMatch(/billed to your Google Cloud project "acme-ai"/);
    expect(r.payload.message).toMatch(/2 Google Cloud projects/);
    expect(JSON.stringify(r.payload)).not.toMatch(/REFRESHSECRET|ya29/);
    const body = new URLSearchParams(String(seen[0].body));
    expect(Object.fromEntries(body)).toMatchObject({ code: 'g-code', client_id: GOOGLE_ID, client_secret: 'google-client-secret', redirect_uri: 'https://app.example.test/ai-models', grant_type: 'authorization_code', code_verifier: VERIFIER });
    expect(enabled[0]).toBe('https://serviceusage.googleapis.com/v1/projects/acme-ai/services/generativelanguage.googleapis.com:enable');
    const conn = db.tables.workspace_connections.find((c) => c.provider === 'gemini');
    expect(conn.config.project).toBe('acme-ai');
    const sec = db.tables.workspace_connection_secrets.find((x) => x.connection_id === conn.id);
    expect(JSON.stringify(sec)).not.toContain('REFRESHSECRET');
    expect(connections.decryptSecrets(sec).google_refresh_token).toBe('1//REFRESHSECRET');
  } finally { withGoogleClient(false); }
});

test('Gemini: a signed-in workspace calls Gemini as the person, billed to their project, and pays no credits', async () => {
  withGoogleClient(true);
  try {
    const conn = { id: 'g1', provider: 'gemini', status: 'active', config: { project: 'acme-ai' } };
    const ov = connections.buildOverrides(null, [conn], new Map([['g1', { google_refresh_token: '1//R', __google_access: 'ya29.LIVE' }]]));
    expect(ov.keys.gemini_oauth).toEqual({ access_token: 'ya29.LIVE', project: 'acme-ai' });
    expect(ov.configured).toContain('gemini');
    const llm = require(path.join(ROOT, 'api', '_shared', 'llm.js'));
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), headers: (init && init.headers) || {} });
      if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hello from gemini' }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error('unrouted ' + url);
    };
    const out = await llm({ systemPrompt: 'sys', userMessage: 'hi', overrides: ov, maxTokens: 50 });
    expect(out.provider).toBe('gemini');
    expect(out.workspace_key).toBe(true);
    const g = calls.find((c) => c.url.startsWith('https://generativelanguage.googleapis.com/'));
    expect(g.url).not.toMatch(/[?&]key=/);
    expect(g.headers.Authorization).toBe('Bearer ya29.LIVE');
    expect(g.headers['x-goog-user-project']).toBe('acme-ai');
  } finally { global.fetch = REAL_FETCH; withGoogleClient(false); }
});

test('Gemini: the page sends the person to Google with PKCE and finishes on the bare page address', async ({ page }) => {
  test.setTimeout(150000);
  withGoogleClient(true);
  const posts = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const send = (status, type, body) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', Connection: 'close' }); res.end(body); };
    if (u.pathname === '/auth.js') return send(200, 'text/javascript', 'window.LifecycleAuth={session:{access_token:"session-token"}};window.LifecycleStatus={decide:async function(){return null;}};window.LifecycleFailure={sentence:function(e){return e.message;},html:function(e){return e.message;},show:function(){}};');
    if (u.pathname === '/api/public-config' && u.searchParams.get('action') === 'connections') {
      const op = u.searchParams.get('op');
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (op === 'ai-signin-exchange') { posts.push(JSON.parse(body || '{}')); return send(200, 'application/json', JSON.stringify({ ok: true, signed_in: true, message: 'Signed in with Google. Gemini now runs as you, billed to your Google Cloud project "acme-ai".' })); }
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
      if (route.request().url().startsWith('https://accounts.google.com/')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>google sign-in</p>' });
      return route.abort('failed');
    });
    await page.goto(`${base}/ai-models`);
    const btn = page.locator('.conn[data-provider="gemini"] [data-act="signin"]');
    await expect(btn).toBeVisible({ timeout: 30000 });
    await page.fill('.conn[data-provider="gemini"] [data-field="project"]', 'acme-ai');
    await btn.click();
    await page.waitForURL(/accounts\.google\.com/, { timeout: 30000 });
    const auth = new URL(page.url());
    expect(auth.searchParams.get('client_id')).toBe(GOOGLE_ID);
    expect(auth.searchParams.get('redirect_uri')).toBe(`${base}/ai-models`);
    expect(auth.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language.retriever');
    expect(auth.searchParams.get('access_type')).toBe('offline');
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    const st = auth.searchParams.get('state');
    await page.goto(`${base}/ai-models?state=${encodeURIComponent(st)}&code=g-one-time&scope=x`);
    await expect(page.locator('[data-signin-result="ok"]')).toContainText('Signed in with Google', { timeout: 30000 });
    expect(page.url()).not.toContain('g-one-time');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ provider: 'gemini', code: 'g-one-time', redirect_uri: `${base}/ai-models`, project: 'acme-ai' });
    expect(require('crypto').createHash('sha256').update(posts[0].code_verifier).digest('base64url')).toBe(auth.searchParams.get('code_challenge'));
  } finally {
    withGoogleClient(false);
    await new Promise((r) => server.close(r));
  }
});
