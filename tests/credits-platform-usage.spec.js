// Credits follow the usage of the platform that made the work (2026-10-20).
//
// The operator: "Ensure credit system is built perfectly and syncs to the
// respective-selected-platform usage for credits correctly and accurately".
// What that means here, each part EXECUTED:
//   1. llm.js reads the tokens each PROVIDER reports in its own response shape
//      (OpenAI-compatible `usage`, Anthropic `usage` + cache reads/writes,
//      Gemini `usageMetadata` + thinking tokens) and the request scope records
//      provider, model, whose key and those counts per answer; a count the
//      provider did not send stays null, never estimated.
//   2. image.js records the picture, its provider and model, the same way.
//   3. The meter charges the PLATFORM's share of a run: all platform = the
//      price; part own keys = the share by reported tokens (by answers when a
//      count is missing or pictures are mixed in), rounded up; all own keys =
//      nothing, and the ledger still records what its own providers used.
//   4. The ledger row and the wallet page's usage read carry that usage per
//      provider, so the spend can be read beside each provider's own usage.
//
// Run: npx playwright test tests/credits-platform-usage.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const { FakeSupabase, installCreditsRpc, makeReq, makeRes, envScope, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');

const ROOT = path.resolve(__dirname, '..');
const credits = require(path.join(ROOT, 'api', '_shared', 'credits-core.js'));
const scope = require(path.join(ROOT, 'api', '_shared', 'request-scope.js'));
const LLM = path.join(ROOT, 'api', '_shared', 'llm.js');
const llm = () => require(LLM);

const ENV = envScope([
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CREDIT_WELCOME_GRANT', 'FREE_GENERATION',
  'OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'GROQ_API_KEY',
  'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'GITHUB_MODELS_TOKEN', 'GITHUB_TOKEN',
  'APP_AI_PROVIDER', 'APP_AI_TIER',
]);
let REAL_FETCH;
test.beforeEach(() => {
  ENV.save();
  REAL_FETCH = global.fetch;
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CREDIT_WELCOME_GRANT = '500';
  process.env.FREE_GENERATION = 'off';
  for (const k of ['OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'GROQ_API_KEY',
    'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'GITHUB_MODELS_TOKEN', 'GITHUB_TOKEN', 'APP_AI_PROVIDER', 'APP_AI_TIER']) delete process.env[k];
  llm().resetProviderCooldowns();
});
test.afterEach(() => { global.fetch = REAL_FETCH; ENV.restore(); llm().resetProviderCooldowns(); });

function world() {
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test').addWorkspace('ws-a', 'user-a').setActive('user-a', 'ws-a').syncIdentityTables();
  installCreditsRpc(db);
  db.install();
  return db;
}
const wallet = (db) => db.find('credit_wallets', (w) => w.user_id === 'user-a' && w.workspace_id === 'ws-a');
const spends = (db) => db.table('credit_ledger').filter((l) => l.kind === 'spend');

/* ── 1. the tokens each provider reports, read off its own response ──────── */

const PROVIDER_HOSTS = { 'api.openai.com': 'openai', 'api.anthropic.com': 'anthropic', 'generativelanguage.googleapis.com': 'gemini', 'api.groq.com': 'groq' };
function providerNet(answers) {
  return async (url) => {
    const host = new URL(String(url)).host;
    const p = PROVIDER_HOSTS[host];
    if (!p) throw new Error('unrouted host: ' + host);
    const body = JSON.stringify(answers[p]);
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => body };
  };
}
const ask = (o) => llm()(Object.assign({ systemPrompt: 'sys', userMessage: 'hi', stage: 'usage-test', overrides: null, tier: 'standard', timeoutMs: 2000 }, o || {}));

test('each provider\'s own usage shape is read, recorded per answer with whose key, and a count it did not send stays null', async () => {
  process.env.OPENAI_API_KEY = 'oa'; process.env.ANTHROPIC_API_KEY = 'ak'; process.env.GEMINI_API_KEY = 'gm'; process.env.GROQ_API_KEY = 'gq';
  global.fetch = providerNet({
    openai: { choices: [{ message: { content: 'from openai' }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } },
    anthropic: { content: [{ type: 'text', text: 'from claude' }], stop_reason: 'end_turn', usage: { input_tokens: 50, cache_creation_input_tokens: 20, cache_read_input_tokens: 10, output_tokens: 40 } },
    gemini: { candidates: [{ content: { parts: [{ text: 'from gemini' }] } }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 60, thoughtsTokenCount: 15 } },
    groq: { choices: [{ message: { content: 'from groq' }, finish_reason: 'stop' }] },
  });
  const u = await scope.run({ headers: {} }, async () => {
    const a = await ask({ preferProvider: 'openai' });
    expect(a.usage).toEqual({ input_tokens: 120, output_tokens: 30 });
    const b = await ask({ preferProvider: 'anthropic' });
    expect(b.usage).toEqual({ input_tokens: 80, output_tokens: 40 });       // cache reads/writes are input too
    const c = await ask({ preferProvider: 'gemini' });
    expect(c.usage).toEqual({ input_tokens: 200, output_tokens: 75 });      // thinking tokens are output
    const d = await ask({ preferProvider: 'groq' });
    expect(d.usage).toEqual({ input_tokens: null, output_tokens: null });   // not reported: not invented
    return scope.llmUsage();
  });
  expect(u.calls).toBe(4);
  const by = Object.fromEntries(u.by_provider.map((g) => [g.provider, g]));
  expect(by.openai).toMatchObject({ key: 'platform', kind: 'text', answers: 1, input_tokens: 120, output_tokens: 30, tokens_reported: true });
  expect(by.anthropic).toMatchObject({ input_tokens: 80, output_tokens: 40, tokens_reported: true });
  expect(by.gemini).toMatchObject({ input_tokens: 200, output_tokens: 75, tokens_reported: true });
  expect(by.groq).toMatchObject({ tokens_reported: false });
  expect(by.openai.model).toBeTruthy();
  // One answer did not report its tokens, so the share is by answers.
  expect(u.basis).toBe('answers');
  expect(u.platform_share).toBe(1);
});

test('an answer on the workspace\'s own key is recorded as its own, beside the platform\'s', async () => {
  process.env.GROQ_API_KEY = 'platform-gq';
  global.fetch = providerNet({
    anthropic: { content: [{ type: 'text', text: 'own' }], usage: { input_tokens: 300, output_tokens: 0 } },
    groq: { choices: [{ message: { content: 'platform' } }], usage: { prompt_tokens: 80, completion_tokens: 20 } },
  });
  const u = await scope.run({ headers: {} }, async () => {
    await ask({ overrides: { order: [], keys: { anthropic: 'ws-ak' }, configured: ['anthropic'], fallback: false } });
    await ask({ preferProvider: 'groq' });
    return scope.llmUsage();
  });
  expect(u.by_provider.find((g) => g.provider === 'anthropic')).toMatchObject({ key: 'own', input_tokens: 300 });
  expect(u.by_provider.find((g) => g.provider === 'groq')).toMatchObject({ key: 'platform', input_tokens: 80, output_tokens: 20 });
  expect(u.basis).toBe('tokens');
  expect(u.platform_share).toBeCloseTo(100 / 400, 10);
});

/* ── 2. the meter charges the platform's share ───────────────────────────── */

const answered = (rows) => async (_req, res) => {
  for (const r of rows) scope.noteLlm('ok', r);
  res.status(200).json({ ok: true, html: '<p>x</p>' });
};
function run(handler, feature = 'ads.generate') {
  const res = makeRes();
  const rq = makeReq({ token: 'tok-a', query: { workspace_id: 'ws-a' } });
  return scope.run(rq, () => credits.metered(handler, () => feature)(rq, res)).then(() => res);
}

test('all platform: the catalogue price, with the provider usage on the ledger row', async () => {
  const db = world();
  const res = await run(answered([{ own: false, kind: 'text', provider: 'groq', model: 'openai/gpt-oss-120b', input_tokens: 900, output_tokens: 300 }]));
  expect(res.code).toBe(200);
  expect(res.payload.credits).toMatchObject({ charged: 18 });
  expect(wallet(db)).toMatchObject({ balance: 482, held: 0, lifetime_spent: 18 });
  const meta = spends(db)[0].meta;
  expect(meta.usage).toMatchObject({ basis: 'tokens', platform_share: 1, charged: 18, full_price: 18, answers: 1 });
  expect(meta.usage.by_provider).toEqual([{ provider: 'groq', model: 'openai/gpt-oss-120b', key: 'platform', kind: 'text', answers: 1, input_tokens: 900, output_tokens: 300, tokens_reported: true, images: 0 }]);
});

test('part own keys: only the platform\'s share by reported tokens, rounded up, never above the price', async () => {
  const db = world();
  // 300 tokens on the workspace's own key, 100 on the platform's: a quarter of 18 = 4.5 -> 5.
  const res = await run(answered([
    { own: true, kind: 'text', provider: 'anthropic', model: 'claude-sonnet-5-5', input_tokens: 250, output_tokens: 50 },
    { own: false, kind: 'text', provider: 'groq', model: 'openai/gpt-oss-120b', input_tokens: 80, output_tokens: 20 },
  ]));
  expect(res.payload.credits).toMatchObject({ charged: 5 });
  expect(res.payload.credits.note).toMatch(/charged 5 of 18 credits/);
  expect(wallet(db)).toMatchObject({ balance: 495, held: 0, lifetime_spent: 5 });
  expect(spends(db)[0].meta.usage).toMatchObject({ basis: 'tokens', platform_share: 0.25, charged: 5, full_price: 18 });
});

test('part own keys with a count missing or a picture in the run: the share is by answers', async () => {
  const db = world();
  const res = await run(answered([
    { own: true, kind: 'text', provider: 'anthropic', model: 'claude-sonnet-5-5', input_tokens: 400, output_tokens: 100 },
    { own: false, kind: 'image', provider: 'pollinations', model: 'flux', images: 1 },
  ]));
  expect(res.payload.credits).toMatchObject({ charged: 9 });
  const u = spends(db)[0].meta.usage;
  expect(u).toMatchObject({ basis: 'answers', platform_share: 0.5, charged: 9 });
  expect(u.by_provider.find((g) => g.kind === 'image')).toMatchObject({ provider: 'pollinations', images: 1, input_tokens: null, output_tokens: null });
  expect(wallet(db)).toMatchObject({ balance: 491, held: 0 });
});

test('all own keys: nothing charged, and the ledger still says which of its providers made it', async () => {
  const db = world();
  const res = await run(answered([{ own: true, kind: 'text', provider: 'openai', model: 'gpt-5.4-mini', input_tokens: 700, output_tokens: 210 }]));
  expect(res.payload.credits).toMatchObject({ charged: 0, own_keys: true });
  expect(res.payload.credits.usage.by_provider[0]).toMatchObject({ provider: 'openai', key: 'own', input_tokens: 700 });
  expect(wallet(db)).toMatchObject({ balance: 500, held: 0, lifetime_spent: 0 });
  const s = spends(db);
  expect(s).toHaveLength(1);
  expect(s[0].meta.usage).toMatchObject({ platform_share: 0, charged: 0, full_price: 18 });
  expect(s[0].meta.note).toMatch(/own model keys/);
});

test('a run that recorded no model answer (a template, a voice) is charged its price, with no usage invented', async () => {
  const db = world();
  const res = await run(async (_q, r) => r.status(200).json({ ok: true }), 'mailer.generate');
  expect(res.payload.credits).toMatchObject({ charged: 20 });
  expect(spends(db)[0].meta.usage).toBeUndefined();
});

/* ── 3. the wallet page reads usage per provider ─────────────────────────── */

test('op=usage reports each provider by key with its tokens, pictures and the credits its share cost; op=ledger carries usage, never the raw meta', async () => {
  const db = world();
  await run(answered([{ own: false, kind: 'text', provider: 'groq', model: 'm1', input_tokens: 100, output_tokens: 50 }]));
  await run(answered([
    { own: true, kind: 'text', provider: 'anthropic', model: 'claude-sonnet-5-5', input_tokens: 250, output_tokens: 50 },
    { own: false, kind: 'text', provider: 'groq', model: 'm2', input_tokens: 80, output_tokens: 20 },
  ]));
  await run(answered([{ own: false, kind: 'image', provider: 'pollinations', model: 'flux', images: 1 }]), 'image.generate');
  await run(async (_q, r) => r.status(200).json({ ok: true }), 'mailer.generate');
  // A payment row's meta is the operator's: it must not reach the page.
  db.table('credit_ledger').push({ id: 'x-grant', wallet_id: wallet(db).id, user_id: 'user-a', workspace_id: 'ws-a', kind: 'grant', delta: 10, balance_after: 0, meta: { order_id: 'secret-order' }, created_at: db.tick() });

  const call = async (op) => {
    const res = makeRes();
    await credits.handle(makeReq({ token: 'tok-a', method: 'GET', query: { op, workspace_id: 'ws-a', days: '7' } }), res);
    return res;
  };
  const u = await call('usage');
  expect(u.code).toBe(200);
  const p = u.payload.by_provider;
  const imageCost = credits.catalog.list().find((f) => f.key === 'image.generate').cost;
  expect(p).toMatchObject({ days: 7, runs: 4, runs_without_usage: 1, charged: 18 + 5 + imageCost, full_price: 18 + 18 + imageCost, saved_by_own_keys: 13 });
  const row = (prov, key) => p.providers.find((g) => g.provider === prov && g.key === key);
  expect(row('groq', 'platform')).toMatchObject({ runs: 2, answers: 2, input_tokens: 180, output_tokens: 70, tokens_complete: true, credits: 23 });
  expect(row('groq', 'platform').models.slice().sort()).toEqual(['m1', 'm2']);
  expect(row('anthropic', 'own')).toMatchObject({ runs: 1, input_tokens: 250, output_tokens: 50, credits: 0 });
  expect(row('pollinations', 'platform')).toMatchObject({ images: 1, credits: imageCost });

  const l = await call('ledger');
  expect(l.payload.entries.every((e) => !('meta' in e))).toBe(true);
  expect(JSON.stringify(l.payload)).not.toContain('secret-order');
  expect(l.payload.entries.filter((e) => e.kind === 'spend' && e.usage).length).toBe(3);
});

/* ── 4. image.js records its picture through the same door ───────────────── */

test('image.js: a picture the platform drew is charged with its provider and model on the receipt and the ledger', async () => {
  test.setTimeout(60_000);
  const db = world();
  process.env.FREE_GENERATION = 'on';
  const png = Buffer.alloc(8000, 7);
  db.route((u) => /image\.pollinations\.ai/.test(u), () => ({ ok: true, status: 200, headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'image/png' : null) }, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength), text: async () => '' }));
  db.route((u) => /api\.openai\.com|generativelanguage\.googleapis\.com|api\.cloudflare\.com/.test(u), () => ({ ok: false, status: 500, headers: { get: () => null }, text: async () => 'down', json: async () => ({}) }));
  const image = require(path.join(ROOT, 'api', 'ai', 'image.js'));
  const res = makeRes();
  await image(makeReq({ token: 'tok-a', method: 'POST', query: { workspace_id: 'ws-a' }, body: { prompt: 'A pair of round frames on a light desk', mode: 'photo', size: '1024x1024' } }), res);
  expect(res.code, JSON.stringify(res.payload).slice(0, 300)).toBe(200);
  expect(res.payload.provider).toBe('pollinations');
  const u = res.payload.credits.usage;
  expect(u.by_provider).toEqual([expect.objectContaining({ provider: 'pollinations', key: 'platform', kind: 'image', images: 1 })]);
  expect(u.by_provider[0].model).toMatch(/flux/);
  expect(spends(db)[0].meta.usage.by_provider[0]).toMatchObject({ provider: 'pollinations', images: 1 });
});

/* ── 5. the wallet page shows it, at a desk and on a phone ───────────────── */

const http = require('http');
const fs = require('fs');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

for (const width of [1280, 390]) {
  test(`/credits at ${width}px: usage by model provider, whose key, tokens and credits; the ledger row names the provider`, async ({ page }) => {
    const db = world();
    await run(answered([{ own: false, kind: 'text', provider: 'groq', model: 'openai/gpt-oss-120b', input_tokens: 900, output_tokens: 300 }]));
    await run(answered([
      { own: true, kind: 'text', provider: 'anthropic', model: 'claude-sonnet-5-5', input_tokens: 250, output_tokens: 50 },
      { own: false, kind: 'text', provider: 'groq', model: 'openai/gpt-oss-120b', input_tokens: 80, output_tokens: 20 },
    ]));
    const server = http.createServer((req, res) => {
      const [u] = (req.url || '/').split('?');
      const file = path.join(ROOT, u === '/' ? 'index.html' : u.replace(/^\//, ''));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      const thrown = [];
      page.on('pageerror', (e) => thrown.push(String(e.message || e)));
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => (r.request().resourceType() === 'script' ? r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }) : r.abort('failed')));
      await page.route(/\/api\//, async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('action') === 'credits') {
          // The SHIPPED handler over the fake project; the session is the test's.
          const res = makeRes();
          const q = Object.fromEntries(url.searchParams.entries());
          await credits.handle(makeReq({ token: 'tok-a', method: route.request().method(), query: Object.assign(q, { workspace_id: 'ws-a' }) }), res);
          return route.fulfill({ status: res.code, contentType: 'application/json', body: JSON.stringify(res.payload) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      });
      await page.goto('http://127.0.0.1:' + server.address().port + '/credits.html', { waitUntil: 'domcontentloaded' });
      const rows = page.locator('#providers tr[data-provider]');
      await expect(rows).toHaveCount(2, { timeout: 15000 });
      const groq = page.locator('#providers tr[data-provider="groq"][data-key="platform"]');
      await expect(groq).toContainText('openai/gpt-oss-120b');
      await expect(groq).toContainText('980');     // tokens in, as groq reported them
      await expect(groq).toContainText('320');     // tokens out
      await expect(groq).toContainText('23');      // 18 + 5 credits
      await expect(page.locator('#providers tr[data-provider="anthropic"][data-key="own"]')).toContainText('Your key');
      await expect(page.locator('#providers')).toContainText('13 not charged: made with your own keys');
      await expect(page.locator('#ledger')).toContainText('groq openai/gpt-oss-120b (platform): 80 in / 20 out tokens');
      await expect(page.locator('#ledger')).toContainText('Charged 5 of 18');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      // The operator's phone (2026-10-25): the ledger's note was squeezed into
      // a column one word wide. No cell holding text may be narrower than a
      // third of its table, and on a phone each value sits beside its label.
      const squeezed = await page.evaluate(() => {
        const out = [];
        for (const t of document.querySelectorAll('#prices, #usage, #providers, #ledger')) {
          const tw = t.getBoundingClientRect().width;
          for (const td of t.querySelectorAll('tbody td')) {
            if (!td.textContent.trim() || td.querySelector('.bar')) continue;
            const w = td.getBoundingClientRect().width;
            if (w < tw / 3) out.push(t.id + ': ' + td.textContent.trim().slice(0, 40) + ' (' + Math.round(w) + 'px of ' + Math.round(tw) + ')');
          }
        }
        return out;
      });
      if (width < 500) {
        expect(squeezed).toEqual([]);
        const note = page.locator('#ledger td[data-label="Note"]').filter({ hasText: 'Charged 5 of 18' });
        await expect(note).toHaveCount(1);
      }
      expect(thrown).toEqual([]);
      void db;
    } finally {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
}
