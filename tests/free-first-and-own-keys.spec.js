// Free first in the backend, the user's own models when they connect them
// (2026-10-17).
//
// The operator: "everything will cost the user credits - but it should be done
// for free in the backend", then "users should still have the option to
// integrate the ai models they want to use themselves ... if entered, then only
// those ai models shall be used with the priority order ... claude, openai,
// gemini, grok", and "if no model key entered by user then for the user, it
// should not seem as free".
//
// Executed: the shipped api/ai/image.js through its credit and request-scope
// wrappers over the fake project, every provider answered by a recorder; the
// shipped video core. The text cascade's order is in llm-provider-chain.spec.js.
//
// Run: npx playwright test tests/free-first-and-own-keys.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const A = require('./agents-harness');
const H = require('./router-harness');

const ROOT = path.resolve(__dirname, '..');
const WCC = path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js');

async function imageWorld(env) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  const w = await A.world({ routers: { '/api/ai/image': 'api/ai/image.js' } });
  const uid = 'user-ff', tok = H.jwtShaped(uid);
  w.db.addUser(tok, uid, 'ff@example.test').addWorkspace('ws-ff', uid, {
    name: 'Freefirst Fixture', slug: 'freefirst-fixture', industry: 'Eyewear', website: 'https://freefirst.example.test',
    palette: { primary: '#1D3A8A', accent: '#16A3A3', ink: '#14161C', surface: '#FFFFFF' }, regions: [{ code: 'IN', currency: 'INR', home: true }],
    status: 'active', created_at: '2026-09-20T00:00:00.000Z',
  }).setActive(uid, 'ws-ff');
  w.db.syncIdentityTables();
  const calls = [];
  const fail = () => ({ ok: false, status: 500, headers: { get: () => null }, text: async () => 'recorder', json: async () => ({ error: { message: 'recorder' } }), arrayBuffer: async () => new ArrayBuffer(0) });
  w.db.route((u) => /api\.openai\.com|generativelanguage\.googleapis\.com|image\.pollinations\.ai|api\.cloudflare\.com/.test(u), (u, init) => {
    const h = (init && init.headers) || {};
    calls.push({ host: new URL(u).host, auth: String(h.Authorization || h.authorization || h['x-goog-api-key'] || '') + (/[?&]key=([^&]+)/.exec(u) || ['', ''])[1] });
    return fail();
  });
  const request = (json) => { w.reset(); return w.request('/api/ai/image', { json, headers: { authorization: 'Bearer ' + tok } }); };
  const close = async () => { await w.close(); for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  return { calls, request, close };
}
const BODY = { prompt: 'A pair of round frames on a light desk', mode: 'photo', size: '1024x1024' };

test('images, free generation on: the free rung is asked before any paid provider, even with paid keys set', async () => {
  test.setTimeout(120_000);
  const w = await imageWorld({ FREE_GENERATION: 'on', OPENAI_API_KEY: 'platform-oa', GEMINI_API_KEY: 'platform-gm' });
  try {
    // The premium tier, whose paid-first order opens on OpenAI: free first
    // must still ask the free rung before it.
    const r = await w.request(Object.assign({ tier: 'premium' }, BODY));
    expect(r.status).toBe(200);
    const hosts = w.calls.map((c) => c.host);
    expect(hosts[0], `order: ${hosts.join(' > ')}`).toBe('image.pollinations.ai');
    const firstPaid = hosts.findIndex((h) => h === 'api.openai.com' || h === 'generativelanguage.googleapis.com');
    expect(firstPaid).toBeGreaterThan(hosts.lastIndexOf('image.pollinations.ai'));
  } finally { await w.close(); }
});

test('images, the workspace\'s own OpenAI key: only that key draws; the platform\'s keys and the free rung are not used', async () => {
  test.setTimeout(120_000);
  const w = await imageWorld({ FREE_GENERATION: 'on', OPENAI_API_KEY: 'platform-oa', GEMINI_API_KEY: 'platform-gm' });
  // The workspace's connected key, as workspace-connections-core resolves it
  // for this request (its own storage is executed in workspace-connections).
  const wcc = require(WCC);
  const real = wcc.llmOverridesForCurrentRequest;
  wcc.llmOverridesForCurrentRequest = async () => ({ order: [], keys: { openai: 'ws-own-oa' }, configured: ['openai'], fallback: true, source: 'workspace' });
  try {
    await w.request(BODY);
    expect(w.calls.length, 'nothing was asked').toBeGreaterThan(0);
    for (const c of w.calls) {
      expect(c.host).toBe('api.openai.com');
      expect(c.auth).toContain('ws-own-oa');
      expect(c.auth).not.toContain('platform-oa');
    }
  } finally { wcc.llmOverridesForCurrentRequest = real; await w.close(); }
});

test('video, free generation on: rendered in code, no paid video provider called even with a key; off: the provider is tried', async () => {
  const VC = path.join(ROOT, 'api', '_shared', 'video-core.js');
  const saved = { FREE_GENERATION: process.env.FREE_GENERATION, RUNWAY_API_KEY: process.env.RUNWAY_API_KEY };
  const realFetch = global.fetch;
  const hit = [];
  global.fetch = async (u) => { hit.push(String(u)); return { ok: false, status: 500, headers: { get: () => null }, text: async () => 'down', json: async () => ({}) }; };
  try {
    process.env.RUNWAY_API_KEY = 'rw-key';
    process.env.FREE_GENERATION = 'on';
    delete require.cache[require.resolve(VC)];
    const on = await require(VC).generateVideo({ prompt: 'frames on a desk', brand: { name: 'Freefirst', palette: { primary: '#1D3A8A' } }, budget_ms: 3000 });
    expect(on.provider).toBe('code-motion');
    expect(on.motion_html).toBeTruthy();
    expect(hit.filter((u) => /runway|openai|googleapis|higgsfield/i.test(u))).toEqual([]);
    process.env.FREE_GENERATION = 'off';
    delete require.cache[require.resolve(VC)];
    await require(VC).generateVideo({ prompt: 'frames on a desk', brand: { name: 'Freefirst' }, budget_ms: 3000 });
    expect(hit.some((u) => /runway/i.test(u)), 'free generation off: the keyed provider is tried').toBe(true);
  } finally {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    delete require.cache[require.resolve(VC)];
  }
});
