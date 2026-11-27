// The assistant's built-in kit (2026-11-27): retrieval over the brand's own
// documents, memory across sessions, its read tools over MCP, an evaluation
// run, and the social post fixes found the same day. EXECUTED: the shipped
// modules are required and called; the model is a scripted function and
// `global.fetch` throws on anything a case did not route.
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KIT = require(path.join(ROOT, 'api/_shared/assistant-kit.js'));

const BRAND = {
  id: 'b1', name: 'Brambleweld Larder', website: 'https://brambleweld.example',
  tagline: 'Slow-cured meats from one Somerset smokehouse.',
  claims: ['Cured for 28 days over beech wood', 'Delivered chilled across the UK in two days'],
  offerings: [{ name: 'Smoked streaky bacon', kind: 'product', url: 'https://brambleweld.example/bacon' }, { name: 'Gift hampers', kind: 'product' }],
  voice: { tone: 'plain and warm', banned: ['artisan'] },
  regions: [{ code: 'UK', home: true, store_url: 'https://brambleweld.example' }],
};

function fakeRes() {
  return { code: 200, body: undefined, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { this.ended = true; return this; } };
}

test.describe('assistant kit', () => {
  let realFetch;
  test.beforeEach(() => { realFetch = global.fetch; global.fetch = async (u) => { throw new Error('unrouted fetch: ' + u); }; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SERVICE_KEY; });
  test.afterEach(() => { global.fetch = realFetch; });

  test('retrieval ranks the passage that answers, says how it ranked, and never ranks nothing as something', async () => {
    const found = await KIT.retrieve('how many days is it cured', { brand: BRAND, key: '' });
    expect(found.ranked_by).toBe('words');
    expect(found.items[0].text).toContain('28 days');
    expect(found.items[0].source).toBe('record');
    expect(found.note).toMatch(/BM25/);
    const block = KIT.contextBlock(found);
    expect(block).toMatch(/^PASSAGES FROM THIS BRAND/);
    expect(block).toContain('[1] (record');
    // A question no passage shares a word with returns no passage.
    expect((await KIT.retrieve('zebra crossing regulations', { brand: BRAND, key: '' })).items).toEqual([]);
    // A brand with nothing on record says so.
    const none = await KIT.retrieve('anything', { brand: { name: 'Ozzlewick' }, key: '' });
    expect(none.items).toEqual([]);
    expect(none.note).toMatch(/no documents on record/);
  });

  test('with the workspace\'s own key passages are ranked by meaning; a refusal falls back to words', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
      const input = JSON.parse(init.body).input;
      // "delivery" passage and the question share a direction; the rest do not.
      return { ok: true, json: async () => ({ data: input.map((t) => ({ embedding: /how fast does it arrive|two days/i.test(t) ? [1, 0] : [0, 1] })) }) };
    };
    const found = await KIT.retrieve('how fast does it arrive', { brand: BRAND, key: 'own-key', fetchImpl });
    expect(calls[0].url).toBe('https://api.openai.com/v1/embeddings');
    expect(calls[0].auth).toBe('Bearer own-key');
    expect(found.ranked_by).toBe('meaning');
    expect(found.items[0].text).toContain('two days');
    const refused = await KIT.retrieve('cured beech wood', { brand: Object.assign({}, BRAND, { claims: BRAND.claims.concat('Another line entirely for a fresh cache') }), key: 'own-key', fetchImpl: async () => ({ ok: false, status: 401 }) });
    expect(refused.ranked_by).toBe('words');
    expect(refused.note).toMatch(/did not answer/);
  });

  test('memory keeps a sentence once, never a secret, and says it lives on the device with no store', async () => {
    expect(KIT.cleanMemory('My key is sk-abcdefghijklmnop1234')).toBeNull();
    expect(KIT.cleanMemory('password: hunter2 for the store')).toBeNull();
    expect(KIT.cleanMemory('[DATA REQUIRED BEFORE LAUNCH: x]')).toBeNull();
    expect(KIT.cleanMemory({ text: 'Always write in British English', kind: 'preference' })).toEqual({ text: 'Always write in British English', kind: 'preference', shared: false });
    const got = await KIT.remember({ workspaceId: null, userId: null, items: ['Always write in British English', 'always write in british english', 'No discounts above 15 percent'], existing: [] });
    expect(got.storage).toBe('device');
    expect(got.saved.map((m) => m.text)).toEqual(['Always write in British English', 'No discounts above 15 percent']);
    const mem = await KIT.memories({ workspaceId: null, userId: null, carried: got.saved });
    expect(mem.storage).toBe('device');
    expect(mem.items).toHaveLength(2);
    expect(KIT.memoryBlock(mem.items)).toContain('- (context) No discounts above 15 percent');
  });

  test('memory on the account: the person\'s own rows and shared ones are read, and a write names the verified person', async () => {
    process.env.SUPABASE_URL = 'https://proj.example'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    const WS = '11111111-1111-4111-8111-111111111111'; const U = '22222222-2222-4222-8222-222222222222';
    const seen = [];
    global.fetch = async (url, init) => {
      seen.push({ url: String(url), method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : null });
      if (/assistant_memory\?/.test(url) && (!init || !init.method || init.method === 'GET')) return { ok: true, text: async () => JSON.stringify([{ id: 'a', text: 'Tone stays plain', kind: 'preference', shared: true, user_id: 'someone-else' }]) };
      if (/assistant_memory$/.test(url)) return { ok: true, text: async () => JSON.stringify(JSON.parse(init.body).map((r, i) => Object.assign({ id: 'new' + i }, r))) };
      throw new Error('unrouted ' + url);
    };
    const mem = await KIT.memories({ workspaceId: WS, userId: U });
    expect(mem.storage).toBe('account');
    expect(seen[0].url).toContain(`workspace_id=eq.${WS}`);
    expect(seen[0].url).toContain(`or=(user_id.eq.${U},shared.is.true)`);
    expect(mem.items[0].mine).toBe(false);
    const got = await KIT.remember({ workspaceId: WS, userId: U, items: [{ text: 'Send mail on Tuesdays only', kind: 'decision' }], existing: mem.items });
    expect(got.storage).toBe('account');
    expect(seen[1].body).toEqual([{ workspace_id: WS, user_id: U, text: 'Send mail on Tuesdays only', kind: 'decision', shared: false }]);
    delete process.env.SUPABASE_URL;
  });

  test('a chat turn carries what is remembered and the brand\'s own passages, and keeps what the model was told to remember', async () => {
    const llmPath = require.resolve(path.join(ROOT, 'api/_shared/llm.js'));
    const bllmPath = require.resolve(path.join(ROOT, 'api/_shared/brand-llm.js'));
    const saved = { llm: require.cache[llmPath], b: require.cache[bllmPath] };
    const prompts = [];
    const fn = async (o) => { prompts.push(o); return { text: JSON.stringify({ action: 'final', reply: 'It is cured for 28 days [1].', remember: [{ text: 'Prefers answers in one sentence', kind: 'preference' }, { text: 'api key sk-abcdefghijklmnop9999' }] }), provider: 'scripted', model: 'm' }; };
    require.cache[llmPath] = { id: llmPath, filename: llmPath, loaded: true, exports: fn };
    delete require.cache[bllmPath];
    try {
      const brandLlm = require(bllmPath);
      const out = await brandLlm.chat({ message: 'How long is the bacon cured?', brand: BRAND, memory: [{ text: 'Always write in British English', kind: 'preference' }] });
      expect(out.reply).toContain('28 days');
      const sys = prompts[0].systemPrompt;
      expect(sys).toContain('WHAT YOU REMEMBER FROM EARLIER SESSIONS');
      expect(sys).toContain('Always write in British English');
      expect(sys).toContain('PASSAGES FROM THIS BRAND');
      expect(sys).toContain('Cured for 28 days over beech wood');
      expect(out.retrieval.ranked_by).toBe('words');
      expect(out.retrieval.sources.length).toBeGreaterThan(0);
      expect(out.memory.kept.map((m) => m.text)).toEqual(['Prefers answers in one sentence']);
      expect(out.memory.kept[0].storage).toBe('device');
    } finally {
      if (saved.llm) require.cache[llmPath] = saved.llm; else delete require.cache[llmPath];
      delete require.cache[bllmPath];
      if (saved.b) require.cache[bllmPath] = saved.b;
    }
  });

  test('MCP: lists only read tools, runs one for the caller\'s brand, and takes no brand or workspace from the client', async () => {
    const MCP = require(path.join(ROOT, 'api/_shared/mcp-server.js'));
    const brandLlm = require(path.join(ROOT, 'api/_shared/brand-llm.js'));
    const ctx = (body) => ({ auth: { ok: true, user_id: 'u' }, workspaceId: null, brand: BRAND, body, market: 'UK' });
    let res = fakeRes();
    await MCP.handle({ method: 'POST' }, res, ctx({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }));
    expect(res.body.result.protocolVersion).toBe('2025-03-26');
    expect(res.body.result.capabilities.tools).toBeTruthy();
    res = fakeRes();
    await MCP.handle({ method: 'POST' }, res, ctx({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    expect(res.code).toBe(202);
    res = fakeRes();
    await MCP.handle({ method: 'POST' }, res, ctx({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    const names = res.body.result.tools.map((t) => t.name);
    expect(names).toContain('search_knowledge_base');
    for (const n of names) expect(brandLlm.TOOLS[n].mutates).toBe(false);
    for (const n of ['generate_calendar', 'generate_assets_for_slot', 'run_agentic_campaign', 'klaviyo', 'ask_analytics', 'analyst_insights']) expect(names).not.toContain(n);
    for (const t of res.body.result.tools) expect(t.inputSchema.type).toBe('object');
    // A writing tool is not callable even by name.
    res = fakeRes();
    await MCP.handle({ method: 'POST' }, res, ctx({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'generate_calendar', arguments: {} } }));
    expect(res.body.error.code).toBe(-32602);
    // A read tool answers for the caller's brand; a forged brand is dropped.
    res = fakeRes();
    await MCP.handle({ method: 'POST' }, res, ctx({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search_knowledge_base', arguments: { query: 'beech wood cured', brand: { name: 'Forged', claims: ['Forged claim about beech wood cured'] }, workspace_id: 'x', __workspaceId: 'y' } } }));
    expect(res.body.result.isError).toBe(false);
    const answer = res.body.result.content[0].text;
    expect(answer).toContain('28 days');
    expect(answer).not.toContain('Forged');
    res = fakeRes();
    await MCP.handle({ method: 'POST' }, res, ctx({ jsonrpc: '2.0', id: 5, method: 'resources/list' }));
    expect(res.body.error.code).toBe(-32601);
    res = fakeRes();
    await MCP.handle({ method: 'GET' }, res, ctx(null));
    expect(res.code).toBe(405);
  });

  test('evaluation: counts retrieval hits, finds a figure the passages do not state, takes the judge\'s scores, and says when nothing can be tested', async () => {
    const EV = require(path.join(ROOT, 'api/_shared/ai-eval.js'));
    const asked = [];
    const llm = async (o) => {
      asked.push(o);
      if (o.stage === 'ai-eval-judge') return { text: JSON.stringify({ grounded: 2, relevant: 4, unsupported: ['It ships to 40 countries.'] }), provider: 'scripted' };
      return { text: 'It is cured for 28 days and ships to 40 countries [1].', provider: 'scripted' };
    };
    const out = await EV.run({ brand: BRAND, llm, limit: 2, key: '' });
    expect(out.ok).toBe(true);
    expect(out.scores.retrieval.of).toBeGreaterThanOrEqual(4);
    expect(out.scores.retrieval.hits).toBe(out.scores.retrieval.of);
    expect(out.scores.answers).toEqual({ asked: 2, answered: 2, with_made_up_figures: 2 });
    expect(out.cases[0].made_up_figures).toEqual(['40']);
    expect(out.scores.judge).toEqual({ judged: 2, grounded: 2, relevant: 4 });
    expect(out.stored).toBe('none');
    expect(out.stored_note).toMatch(/not kept/);
    // Every prompt closes on its output requirement.
    for (const a of asked) expect(a.userMessage).toMatch(/OUTPUT/i);
    // A judge that does not answer is null, never a score.
    const silent = await EV.run({ brand: BRAND, llm: async (o) => { if (o.stage === 'ai-eval-judge') throw new Error('down'); return { text: 'Cured for 28 days [1].' }; }, limit: 1, key: '' });
    expect(silent.scores.judge.grounded).toBeNull();
    expect(silent.scores.answers.with_made_up_figures).toBe(0);
    const none = await EV.run({ brand: { name: 'Ozzlewick' }, llm, key: '' });
    expect(none.ok).toBe(false);
    expect(none.error).toBe('nothing_to_evaluate');
    expect(asked.length).toBe(4);
    // A later run that is worse is said to be.
    expect(EV.compare({ retrieval: { rate: 0.5 }, judge: { grounded: 4, relevant: 4 } }, { scores: { retrieval: { rate: 0.9 }, judge: { grounded: 4.2, relevant: 4 } }, created_at: 't' }).regressed).toEqual([{ metric: 'retrieval rate', was: 0.9, now: 0.5 }]);
  });

  test('a social post for a brand with no product: a picture the build holds, a button true for everyone, tags from its own line', async () => {
    const SA = require(path.join(ROOT, 'api/_shared/social-assets.js'));
    const brand = { name: 'Nik Bakers', tagline: 'Freshly baked breads, cakes, cookies and festive gifts. Explore the collection, find your nearest store or browse our menus.', regions: [{ code: 'IN', home: true }] };
    const built = SA.build({ brand, market: 'IN', cta: 'Order again', id: 's1' }, { campaign_id: 'c1', assets: { ads: [] }, generated_imagery: { url: 'https://img.example/scene.png' } }, { link: 'https://nikbakers.example/' });
    const ig = built.posts.find((p) => p.key === 'instagram_feed');
    const reel = built.posts.find((p) => p.key === 'instagram_reels');
    expect(ig.caption).not.toMatch(/Order again/);
    expect(ig.caption).toMatch(/Visit Nik Bakers: link in bio\.$/);
    expect(ig.media.image_url).toBe('https://img.example/scene.png');
    expect(ig.media.source).toMatch(/generated brand scene/);
    expect(ig.media.gap).toBeUndefined();
    expect(ig.hashtags).toEqual(['#NikBakers', '#Breads', '#Cakes', '#Cookies', '#FestiveGifts']);
    expect(reel.caption).not.toBe(ig.caption);
    expect(built.data_gaps.join(' ')).not.toMatch(/image for social posts/);
    for (const p of built.posts) expect(SA.check(p).filter((f) => f.level === 'block')).toEqual([]);
    // With no picture anywhere the gap is still said, never a made-up image.
    const bare = SA.build({ brand, market: 'IN', id: 's2' }, { campaign_id: 'c2', assets: { ads: [] } }, { link: 'https://nikbakers.example/' });
    expect(bare.posts.find((p) => p.key === 'instagram_feed').media.gap).toMatch(/DATA REQUIRED BEFORE LAUNCH: image for social posts/);
    // A slot button that speaks to everyone is kept.
    const kept = SA.build({ brand, market: 'IN', cta: 'See the menu', id: 's3' }, { campaign_id: 'c3', assets: { ads: [] } }, { link: 'https://nikbakers.example/' });
    expect(kept.posts.find((p) => p.key === 'facebook').caption).toMatch(/See the menu: https:\/\/nikbakers\.example\//);
  });
});
