// A scene made from the product's OWN photo (2026-11-01, Fastlane's statics as
// the bar). The shipped api/ai/image.js, executed: the catalogue photo goes to
// Gemini as an input image (inlineData, the exact bytes) and no text-only
// provider is asked; with no Gemini key, no photo, or a private address, the
// request is refused in a sentence before any image model is called.
// 2026-11-02: OpenAI's image edit endpoint is the second rung (the documented
// JSON body: images[{image_url: data URL}], the exact bytes), own key first,
// then the platform's; with no Gemini AND no OpenAI key the 501 names both.
const { test, expect } = require('@playwright/test');
const A = require('./agents-harness');
const H = require('./router-harness');
const dns = require('dns');

const PHOTO = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const PACK = 'https://cdn.scenebrand.example.test/pack.png';

test('scene: the pack photo reaches Gemini as an input image; refusals call no model', async () => {
  test.setTimeout(120_000);
  const realLookup = dns.promises.lookup;
  dns.promises.lookup = async (host, o) => (/scenebrand\.example\.test$/.test(host) ? [{ address: '93.184.216.34', family: 4 }] : realLookup.call(dns.promises, host, o));
  const saved = process.env.GEMINI_API_KEY;
  const savedOa = { a: process.env.OPENAI_API_KEY, b: process.env.OPENAI_API_KEY_2, c: process.env.OPENAI_API_KEY_3 };
  delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY_2; delete process.env.OPENAI_API_KEY_3;
  const w = await A.world({ routers: { '/api/ai/image': 'api/ai/image.js' } });
  const calls = [];
  try {
    // The harness world sets a never-sent OpenAI key; this test owns the OpenAI keys.
    delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY_2; delete process.env.OPENAI_API_KEY_3;
    const uid = 'user-scene', tok = H.jwtShaped(uid);
    w.db.addUser(tok, uid, 'scene@example.test').addWorkspace('ws-scene', uid, {
      name: 'Scene Brand', slug: 'scene-brand', website: 'https://scenebrand.example.test', status: 'active',
      palette: { primary: '#0F5C3A', accent: '#E8B931', surface: '#FFFFFF', ink: '#1A1A1A' }, regions: [{ code: 'IN', home: true }],
    }).setActive(uid, 'ws-scene');
    w.db.syncIdentityTables();
    w.db.route((u) => u.startsWith('https://cdn.scenebrand.example.test/'), () => ({ ok: true, status: 200, headers: { get: (h) => (/content-type/i.test(h) ? 'image/png' : null) }, arrayBuffer: async () => PHOTO.buffer.slice(PHOTO.byteOffset, PHOTO.byteOffset + PHOTO.length), text: async () => '' }));
    // OpenAI: ONLY the documented edit path answers; anything else throws.
    w.db.route((u) => /^https:\/\/api\.openai\.com\//.test(u), (u, init) => {
      if (u !== 'https://api.openai.com/v1/images/edits') throw new Error('undocumented OpenAI call: ' + u);
      const b = JSON.parse(init.body);
      calls.push({ host: 'api.openai.com', path: '/v1/images/edits', auth: init.headers.Authorization, body: b });
      if (init.headers.Authorization === 'Bearer refused-own-key') {
        const err = { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } };
        return { ok: false, status: 401, headers: { get: () => null }, text: async () => JSON.stringify(err), json: async () => err };
      }
      const payload = { created: 1, data: [{ b64_json: Buffer.from('openai-scene').toString('base64') }], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } };
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payload), json: async () => payload };
    });
    w.db.route((u) => /generativelanguage\.googleapis\.com|image\.pollinations\.ai|api\.cloudflare\.com/.test(u), (u, init) => {
      calls.push({ host: new URL(u).host, body: init && init.body ? JSON.parse(init.body) : null });
      const img = Buffer.from('scene-out').toString('base64');
      const payload = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: img } }] } }] };
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payload), json: async () => payload };
    });
    const auth = { authorization: 'Bearer ' + tok };
    const body = { mode: 'scene', size: '1080x1080', prompt: 'a calm morning at a desk', product: { title: 'Calm Coffee', image_url: PACK } };

    // No Gemini key: refused with the sentence, no model called.
    delete process.env.GEMINI_API_KEY;
    w.reset();
    let r = await w.request('/api/ai/image', { json: body, headers: auth });
    expect(r.status, r.text).toBe(501);
    expect(JSON.parse(r.text).message).toMatch(/connect Gemini or OpenAI/);
    expect(calls, 'a model was asked to draw a pack it cannot see').toEqual([]);

    // With a key: Gemini gets the exact photo bytes as inlineData, and only Gemini is asked.
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    w.reset();
    r = await w.request('/api/ai/image', { json: body, headers: auth });
    expect(r.status, r.text).toBe(200);
    const j = JSON.parse(r.text);
    expect(j.ok).toBe(true);
    expect(j.provider).toBe('gemini');
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.host, 'a provider that cannot take the photo was asked').toBe('generativelanguage.googleapis.com');
    const parts = calls[0].body.contents[0].parts;
    expect(parts[0].inlineData.data).toBe(PHOTO.toString('base64'));
    expect(parts[0].inlineData.mimeType).toBe('image/png');
    expect(parts[1].text).toMatch(/Keep its packaging, shape, label, logo, every printed word/);
    expect(parts[1].text).toContain('Calm Coffee');

    // OpenAI edit as the rung after Gemini: Gemini refused, then OpenAI's own
    // documented edit call carries the exact photo bytes; usage is noted with
    // provider + model and whose key drew it.
    const scope = require('../api/_shared/request-scope.js');
    const realNote = scope.noteLlm; const noted = [];
    scope.noteLlm = function (k, info) { noted.push(info); return realNote.apply(this, arguments); };
    try {
      delete process.env.GEMINI_API_KEY;
      process.env.OPENAI_API_KEY = 'platform-openai-key';
      calls.length = 0; w.reset();
      r = await w.request('/api/ai/image', { json: body, headers: auth });
      expect(r.status, r.text).toBe(200);
      const o = JSON.parse(r.text);
      expect(o.provider).toBe('openai');
      expect(o.model).toBe('gpt-image-2');
      expect(o.scene_key).toBe('platform');
      expect(o.image_data_url).toBe('data:image/png;base64,' + Buffer.from('openai-scene').toString('base64'));
      expect(calls.map((c) => c.host)).toEqual(['api.openai.com']);
      const eb = calls[0].body;
      expect(eb.images).toEqual([{ image_url: 'data:image/png;base64,' + PHOTO.toString('base64') }]);
      expect(eb.size).toBe('1024x1024');
      expect(eb.n).toBe(1);
      expect(eb.prompt).toMatch(/Keep its packaging, shape, label, logo, every printed word/);
      expect(eb.prompt).toContain('Calm Coffee');
      expect(eb).not.toHaveProperty('input_fidelity');
      expect(noted.some((n) => n && n.kind === 'image' && n.provider === 'openai' && n.model === 'gpt-image-2' && n.own === false)).toBe(true);

      // Gemini first when both are keyed: OpenAI is not asked.
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      calls.length = 0; w.reset();
      r = await w.request('/api/ai/image', { json: body, headers: auth });
      expect(JSON.parse(r.text).provider).toBe('gemini');
      expect(calls.every((c) => c.host === 'generativelanguage.googleapis.com')).toBe(true);
      delete process.env.GEMINI_API_KEY;

      // The workspace's OWN OpenAI key is tried before the platform's; refused, the platform's draws.
      const wsc = require('../api/_shared/workspace-connections-core.js');
      const realOv = wsc.llmOverridesForCurrentRequest;
      wsc.llmOverridesForCurrentRequest = async () => ({ keys: { openai: 'refused-own-key' } });
      try {
        calls.length = 0; noted.length = 0; w.reset();
        r = await w.request('/api/ai/image', { json: body, headers: auth });
        expect(r.status, r.text).toBe(200);
        expect(calls.map((c) => c.auth)).toEqual(['Bearer refused-own-key', 'Bearer platform-openai-key']);
        expect(JSON.parse(r.text).scene_key).toBe('platform');
        // Own key answering: recorded as own.
        wsc.llmOverridesForCurrentRequest = async () => ({ keys: { openai: 'good-own-key' } });
        calls.length = 0; noted.length = 0; w.reset();
        r = await w.request('/api/ai/image', { json: body, headers: auth });
        expect(calls.map((c) => c.auth)).toEqual(['Bearer good-own-key']);
        expect(JSON.parse(r.text).scene_key).toBe('own');
        expect(noted.some((n) => n && n.kind === 'image' && n.own === true)).toBe(true);
      } finally { wsc.llmOverridesForCurrentRequest = realOv; }
      delete process.env.OPENAI_API_KEY;
      process.env.GEMINI_API_KEY = 'test-gemini-key';
    } finally { scope.noteLlm = realNote; }

    // No photo / a private address: refused before any model.
    calls.length = 0;
    for (const bad of [{ title: 'Calm Coffee' }, { title: 'Calm Coffee', image_url: 'https://127.0.0.1/p.png' }, { title: '', image_url: PACK }]) {
      w.reset();
      r = await w.request('/api/ai/image', { json: Object.assign({}, body, { product: bad }), headers: auth });
      expect(r.status, JSON.stringify(bad) + ' ' + r.text).toBe(422);
    }
    expect(calls).toEqual([]);
  } finally {
    dns.promises.lookup = realLookup;
    if (saved === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = saved;
    for (const [k, v] of [['OPENAI_API_KEY', savedOa.a], ['OPENAI_API_KEY_2', savedOa.b], ['OPENAI_API_KEY_3', savedOa.c]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await w.close();
  }
});
