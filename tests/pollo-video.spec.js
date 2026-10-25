// Pollo AI as the workspace's own video provider (2026-10-25).
//
// The operator, with Pollo's menus (URL to Video Ads, Photo to Video Ads,
// Product Video) and a key: "try to understand how pollo_ai creates these
// videos - it could help improve output even more". Pollo's platform API
// (docs.pollo.ai, read 2026-10-25) is one key in `x-api-key` that reaches
// Kling and the rest; its product videos are a product PHOTO animated by an
// image-to-video model. So: a workspace saves its own Pollo key (never a
// platform env var: the operator's rule), and every video it makes animates
// the product's own photo through Kling 2.5 Turbo first.
//
// Executed: the shipped video-core over a fetch that answers exactly the
// documented Pollo requests and throws on anything else.
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VC = path.join(ROOT, 'api', '_shared', 'video-core.js');
const WC = path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js');
const SUBMIT = 'https://pollo.ai/api/platform/v1/generation/kling-ai/kling-v2-5-turbo/video';
const STATUS = (id) => `https://pollo.ai/api/platform/v1/generation/${id}/status`;
const PHOTO = 'https://shop.example/cdn/estate.jpg';

function load(mediaKeys) {
  delete require.cache[VC];
  const wc = require(WC);
  wc.mediaKeysForCurrentRequest = async () => mediaKeys;
  return require(VC);
}

function pollo(answer) {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', key: (init.headers || {})['x-api-key'], body: init.body ? JSON.parse(init.body) : null });
    const out = answer(u, init);
    if (!out) throw new Error('unrouted request: ' + u);
    return new Response(JSON.stringify(out.body), { status: out.status || 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { global.fetch = real; } };
}

test.afterEach(() => { delete require.cache[VC]; });

test('the request is the documented Kling 2.5 Turbo shape: the photo as first frame, 5 or 10 seconds', () => {
  const vc = load(null);
  const i2v = vc.polloRequest({ prompt: 'Slow push in on the bag', duration_s: 8, aspect: '9:16', image: PHOTO });
  expect(i2v.url).toBe(SUBMIT);
  expect(i2v.body).toEqual({ input: { image: PHOTO, prompt: 'Slow push in on the bag', duration: 10, mode: 'std' } });
  const t2v = vc.polloRequest({ prompt: 'x'.repeat(2000), duration_s: 5, aspect: '4:5' });
  expect(t2v.body.input).toEqual({ prompt: 'x'.repeat(1500), aspectRatio: '16:9', duration: 5 });
  expect(t2v.body.input.image).toBeUndefined();
});

test("a workspace's own Pollo key animates the product's own photo, even with free generation on, and the job is polled to its video", async () => {
  const saved = process.env.FREE_GENERATION; delete process.env.FREE_GENERATION;
  const net = pollo((u, init) => {
    if (u === SUBMIT && init.method === 'POST') return { body: { taskId: 't-1', status: 'waiting' } };
    if (u === STATUS('t-1')) return { body: { taskId: 't-1', credit: 10, costUsd: 0.6, generations: [{ id: 'g', status: 'succeed', failMsg: null, url: 'https://cdn.pollo.example/v.mp4', cover: 'https://cdn.pollo.example/c.jpg', mediaType: 'video' }] } };
    return null;
  });
  try {
    const vc = load({ pollo: { api_key: 'workspace-key' } });
    const out = await vc.generateVideo({ prompt: 'Slow push in', duration_s: 8, aspect: '9:16', motion: { images: ['not a url', PHOTO], lines: ['Roasted on Tuesdays'] } });
    expect(out.ok).toBe(true);
    expect(out.provider).toBe('pollo');
    expect(out.mode).toBe('image-to-video');
    expect(out.job_id).toBe('t-1');
    expect(net.calls[0]).toMatchObject({ url: SUBMIT, method: 'POST', key: 'workspace-key' });
    expect(net.calls[0].body.input.image).toBe(PHOTO);
    const st = await vc.getVideoStatus({ provider: 'pollo', job_id: 't-1' });
    expect(st).toMatchObject({ ok: true, status: 'completed', video_url: 'https://cdn.pollo.example/v.mp4', cover: 'https://cdn.pollo.example/c.jpg' });
    expect(net.calls[1]).toMatchObject({ url: STATUS('t-1'), key: 'workspace-key' });
  } finally {
    net.restore();
    if (saved === undefined) delete process.env.FREE_GENERATION; else process.env.FREE_GENERATION = saved;
  }
});

test('no Pollo key on the workspace: nothing is sent to Pollo and the code-rendered creative ships', async () => {
  const net = pollo(() => null);
  try {
    const vc = load(null);
    const out = await vc.generateVideo({ prompt: 'Slow push in', duration_s: 8, aspect: '9:16', motion: { images: [PHOTO], lines: ['Roasted on Tuesdays'] } });
    expect(out.provider).toBe('code-motion');
    expect(net.calls.filter((c) => /pollo\.ai/.test(c.url))).toEqual([]);
  } finally { net.restore(); }
});

test('a Pollo refusal is said beside the code-rendered creative, never hidden', async () => {
  const net = pollo((u) => (u === SUBMIT ? { status: 401, body: { errorCode: 'UNAUTHORIZED', message: 'Invalid API key', code: 401 } } : null));
  try {
    const vc = load({ pollo: { api_key: 'revoked' } });
    const out = await vc.generateVideo({ prompt: 'Slow push in', duration_s: 5, aspect: '9:16', motion: { images: [PHOTO], lines: ['x'] } });
    expect(out.provider).toBe('code-motion');
    expect(out.provider_error).toMatch(/Pollo: HTTP 401: UNAUTHORIZED Invalid API key/);
  } finally { net.restore(); }
});

test('a failed generation reports its reason; a status read with no key builds the request and sends nothing', async () => {
  const net = pollo((u) => (u === STATUS('t-2') ? { body: { taskId: 't-2', credit: 0, costUsd: 0, generations: [{ id: 'g', status: 'failed', failMsg: 'image rejected', url: null, mediaType: 'video' }] } } : null));
  try {
    let vc = load({ pollo: { api_key: 'k' } });
    expect(await vc.getVideoStatus({ provider: 'pollo', job_id: 't-2' })).toMatchObject({ ok: false, status: 'failed', error: 'image rejected' });
    vc = load(null);
    const n = net.calls.length;
    const none = await vc.getVideoStatus({ provider: 'pollo', job_id: 't-3' });
    expect(none.connected).toBe(false);
    expect(net.calls.length).toBe(n);
  } finally { net.restore(); }
});

test('Pollo is a workspace connection with no platform key, and a request with no session resolves no key', async () => {
  delete require.cache[WC];
  const wc = require(WC);
  const reg = wc.registryView(true).find((p) => p.id === 'pollo');
  expect(reg).toMatchObject({ category: 'media', platform_default: false, wired: true, llm_provider: null });
  expect(reg.fields.map((f) => f.key)).toEqual(['api_key']);
  expect(await wc.mediaKeysFor({ headers: {}, query: {}, body: {} })).toBeNull();
});
