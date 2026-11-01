// A scene made from the product's OWN photo (2026-11-01, Fastlane's statics as
// the bar). The shipped api/ai/image.js, executed: the catalogue photo goes to
// Gemini as an input image (inlineData, the exact bytes) and no text-only
// provider is asked; with no Gemini key, no photo, or a private address, the
// request is refused in a sentence before any image model is called.
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
  const w = await A.world({ routers: { '/api/ai/image': 'api/ai/image.js' } });
  const calls = [];
  try {
    const uid = 'user-scene', tok = H.jwtShaped(uid);
    w.db.addUser(tok, uid, 'scene@example.test').addWorkspace('ws-scene', uid, {
      name: 'Scene Brand', slug: 'scene-brand', website: 'https://scenebrand.example.test', status: 'active',
      palette: { primary: '#0F5C3A', accent: '#E8B931', surface: '#FFFFFF', ink: '#1A1A1A' }, regions: [{ code: 'IN', home: true }],
    }).setActive(uid, 'ws-scene');
    w.db.syncIdentityTables();
    w.db.route((u) => u.startsWith('https://cdn.scenebrand.example.test/'), () => ({ ok: true, status: 200, headers: { get: (h) => (/content-type/i.test(h) ? 'image/png' : null) }, arrayBuffer: async () => PHOTO.buffer.slice(PHOTO.byteOffset, PHOTO.byteOffset + PHOTO.length), text: async () => '' }));
    w.db.route((u) => /api\.openai\.com|generativelanguage\.googleapis\.com|image\.pollinations\.ai|api\.cloudflare\.com/.test(u), (u, init) => {
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
    expect(JSON.parse(r.text).message).toMatch(/connect Gemini/);
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
    await w.close();
  }
});
