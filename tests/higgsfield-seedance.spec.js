// Real renders through Higgsfield / Seedance (2026-10-25). The operator, with
// the "Kill the AI Tell" card, chose "1+2": the card as a skill AND the app
// rendering real videos through Higgsfield or Seedance with those rules.
//
// The API, read on docs.higgsfield.ai the same day: `Authorization: Key
// <key id>:<secret>`; POST /bytedance/seedance-2.0/image-to-video {image_url,
// prompt, duration 4-15, resolution} or /text-to-video {prompt, duration,
// resolution, aspect_ratio}; the answer {status:'queued', request_id}; GET
// /requests/{id}/status -> queued | in_progress | completed (video.url) |
// failed | nsfw | canceled; POST /estimate/<model path> prices a request and
// spends nothing. The fake below answers exactly those and throws on anything
// else. Executed: the shipped video-core, the shipped connection Test, and the
// /brain "Render with Seedance" button in Chromium.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RR = require(path.join(ROOT, 'api', '_shared', 'render-rules.js'));
const VC = path.join(ROOT, 'api', '_shared', 'video-core.js');
const WC = path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js');
const HF = 'https://api.higgsfield.ai';
const I2V = HF + '/bytedance/seedance-2.0/image-to-video';
const T2V = HF + '/bytedance/seedance-2.0/text-to-video';
const PHOTO = 'https://shop.example/cdn/bag.jpg';
const OWN = { higgsfield: { api_key: 'kid-own', api_secret: 'ksec-own' } };

function higgsfield({ submit, status, estimate } = {}) {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    const call = { url: u, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    let out = null;
    if ((u === I2V || u === T2V) && call.method === 'POST') out = submit ? submit(call) : { body: { status: 'queued', request_id: 'req-' + calls.length } };
    else if (/^https:\/\/api\.higgsfield\.ai\/requests\/[^/]+\/status$/.test(u) && call.method === 'GET') out = status ? status(call) : { body: { status: 'in_progress' } };
    else if (u === HF + '/estimate/bytedance/seedance-2.0/text-to-video' && call.method === 'POST') out = estimate ? estimate(call) : { body: { usd: '0.40' } };
    if (!out) throw new Error('unrouted request: ' + call.method + ' ' + u);
    return new Response(JSON.stringify(out.body), { status: out.status || 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { global.fetch = real; } };
}
function loadVC(media) {
  delete require.cache[VC];
  const wc = require(WC);
  wc.mediaKeysForCurrentRequest = async () => media;
  wc.llmOverridesForCurrentRequest = async () => null;
  return require(VC);
}
function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  return Promise.resolve().then(fn).finally(() => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
}
const NO_PLATFORM = { HIGGSFIELD_API_KEY: null, HIGGSFIELD_API_SECRET: null, GEMINI_API_KEY: null, OPENAI_API_KEY: null, OPENAI_API_KEY_2: null, OPENAI_API_KEY_3: null, OPENMONTAGE_API_KEY: null, RUNWAY_API_KEY: null };

test('with the product\'s photo, the workspace\'s own key renders Seedance 2.0 image-to-video, the packshot rules on the prompt', async () => {
  await withEnv(NO_PLATFORM, async () => {
    const n = higgsfield();
    try {
      const vc = loadVC(OWN);
      const out = await vc.generateVideo({ prompt: 'Slow push in on the bag', duration_s: 30, aspect: '9:16', motion: { images: ['not a url', PHOTO] } });
      expect(out).toMatchObject({ ok: true, provider: 'higgsfield', status: 'processing', model: 'seedance-2.0', mode: 'image-to-video', own: true });
      expect(out.job_id).toBe('req-1');
      expect(n.calls.length).toBe(1);
      const c = n.calls[0];
      expect(c.url).toBe(I2V);
      expect(c.headers.Authorization).toBe('Key kid-own:ksec-own');
      expect(c.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
      // Framing follows the photo: no aspect ratio on image-to-video. Duration
      // held to Seedance's 4-15.
      expect(Object.keys(c.body).sort()).toEqual(['duration', 'image_url', 'prompt', 'resolution']);
      expect(c.body).toMatchObject({ image_url: PHOTO, duration: 15, resolution: '720p' });
      expect(c.body.prompt.startsWith('Slow push in on the bag')).toBe(true);
      expect(c.body.prompt).toContain(RR.COMPACT_PACKSHOT);
      expect(c.body.prompt).toMatch(/move only the camera and the light, add nothing to it/);
      expect(c.body.prompt).not.toMatch(/object out of place/);
    } finally { n.restore(); delete require.cache[VC]; }
  });
});

test('with no photo it is text-to-video with the scene rules and an aspect ratio Seedance takes', async () => {
  await withEnv(NO_PLATFORM, async () => {
    const n = higgsfield();
    try {
      const vc = loadVC(OWN);
      const out = await vc.generateVideo({ prompt: 'A customer unboxes the bag at the kitchen table', duration_s: 2, aspect: '9:16' });
      expect(out).toMatchObject({ ok: true, provider: 'higgsfield', mode: 'text-to-video' });
      const c = n.calls[0];
      expect(c.url).toBe(T2V);
      expect(c.body).toMatchObject({ duration: 4, resolution: '720p', aspect_ratio: '9:16' });
      expect(c.body.prompt).toContain(RR.COMPACT);
      expect(c.body.prompt).toMatch(/If a person is in frame \(never add one\)/);
      await vc.generateVideo({ prompt: 'x', aspect: '2:1' });
      expect(n.calls[1].body.aspect_ratio).toBe('16:9');
    } finally { n.restore(); delete require.cache[VC]; }
  });
});

test('the job is read at /requests/{id}/status: queued, completed with the video, and every refusal in words', async () => {
  const answers = {
    q: { status: 'queued', request_id: 'q' },
    ip: { status: 'in_progress', request_id: 'ip' },
    ok: { status: 'completed', request_id: 'ok', video: { url: 'https://cdn.higgsfield.ai/v.mp4' }, expires_at: '2026-11-01T00:00:00Z' },
    empty: { status: 'completed', request_id: 'empty' },
    bad: { status: 'failed', request_id: 'bad', error: 'Generation failed' },
    nsfw: { status: 'nsfw', request_id: 'nsfw' },
    gone: { status: 'canceled', request_id: 'gone' },
  };
  const n = higgsfield({ status: (c) => ({ body: answers[c.url.split('/requests/')[1].split('/')[0]] }) });
  try {
    const vc = loadVC(OWN);
    const st = (id) => vc.getVideoStatus({ provider: 'higgsfield', job_id: id });
    expect(await st('q')).toMatchObject({ ok: true, status: 'processing' });
    expect(await st('ip')).toMatchObject({ ok: true, status: 'processing' });
    expect(await st('ok')).toMatchObject({ ok: true, status: 'completed', video_url: 'https://cdn.higgsfield.ai/v.mp4', expires_at: '2026-11-01T00:00:00Z' });
    expect(await st('empty')).toMatchObject({ ok: false, status: 'failed', error: 'completed without a video url' });
    expect(await st('bad')).toMatchObject({ ok: false, status: 'failed', error: 'Generation failed' });
    expect((await st('nsfw')).error).toMatch(/moderation refused the render \(not charged\)/);
    expect((await st('gone')).error).toMatch(/canceled/);
    expect(n.calls.every((c) => c.headers.Authorization === 'Key kid-own:ksec-own')).toBe(true);
  } finally { n.restore(); delete require.cache[VC]; }
});

test('"Render with Seedance": Higgsfield only, on the workspace\'s own key only; no key is said before any request, and a refusal is said in words', async () => {
  // The platform's pair is set and still never billed for the button.
  await withEnv(Object.assign({}, NO_PLATFORM, { HIGGSFIELD_API_KEY: 'kid-plat', HIGGSFIELD_API_SECRET: 'ksec-plat' }), async () => {
    let n = higgsfield();
    try {
      const vc = loadVC(null);
      const out = await vc.generateVideo({ prompt: 'Slow push in', only: 'higgsfield', motion: { images: [PHOTO] } });
      expect(out.error).toBe('no_higgsfield_key');
      expect(out.message).toMatch(/Connect Higgsfield on Connections/);
      expect(out.would_request.url).toBe(I2V);
      expect(n.calls.length).toBe(0);
    } finally { n.restore(); }
    n = higgsfield({ submit: () => ({ status: 403, body: { detail: 'Insufficient balance' } }) });
    try {
      const vc = loadVC(OWN);
      const out = await vc.generateVideo({ prompt: 'Slow push in', only: 'higgsfield' });
      expect(out).toMatchObject({ ok: false, provider: 'higgsfield' });
      expect(out.error).toBe('HTTP 403: the Higgsfield balance is too low (Insufficient balance)');
      // Asked for Seedance by name: no other provider and no code creative.
      expect(n.calls.length).toBe(1);
      expect(out.motion_html).toBeUndefined();
    } finally { n.restore(); delete require.cache[VC]; }
  });
});

test('a dry run (social-run-daily) submits nothing on the workspace\'s own key: the code creative and the request it would send', async () => {
  await withEnv(NO_PLATFORM, async () => {
    const n = higgsfield();
    try {
      const vc = loadVC(Object.assign({ pollo: { api_key: 'pollo-own' } }, OWN));
      const out = await vc.generateVideo({ prompt: 'Slow push in', aspect: '9:16', dry_run: true, brand: { name: 'Fernwick Roasters' }, motion: { images: [PHOTO] } });
      expect(out.provider).toBe('code-motion');
      expect(out.would_request.url).toBe(I2V);
      expect(out.note).toMatch(/dry run, so no render was submitted/);
      expect(n.calls.length).toBe(0);
    } finally { n.restore(); delete require.cache[VC]; }
    // Through the shipped Social OS run with dry_run on.
    const n2 = higgsfield();
    const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
    const SC = require.resolve(path.join(ROOT, 'api', '_shared', 'social-core.js'));
    const savedLlm = require.cache[LLM];
    const down = async () => { throw new Error('ALL PROVIDERS FAILED'); };
    Object.assign(down, require(LLM));
    require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: down };
    try {
      loadVC(OWN);
      delete require.cache[SC];
      await require(SC).runDaily({ brand: { name: 'Fernwick Roasters', regions: [{ code: 'UK', home: true }] }, dry_run: true, date: '2026-10-20' });
      expect(n2.calls.filter((c) => c.url.startsWith(HF)).length).toBe(0);
    } finally { n2.restore(); require.cache[LLM] = savedLlm; delete require.cache[SC]; delete require.cache[VC]; }
  });
});

test('an own key that refuses falls back to the code-rendered creative and says why', async () => {
  await withEnv(Object.assign({}, NO_PLATFORM, { FREE_GENERATION: null }), async () => {
    const n = higgsfield({ submit: () => ({ status: 401, body: { detail: 'Invalid credentials' } }) });
    try {
      const vc = loadVC(OWN);
      const out = await vc.generateVideo({ prompt: 'Slow push in', aspect: '9:16', brand: { name: 'Fernwick Roasters' } });
      expect(out.provider).toBe('code-motion');
      expect(out.provider_error).toBe('Seedance (your Higgsfield key): HTTP 401: the key id and secret were rejected (Invalid credentials)');
    } finally { n.restore(); delete require.cache[VC]; }
  });
});

test('the platform\'s pair is used only in the paid cascade, never ahead of the person\'s own key, and only with both halves', async () => {
  // Free generation on (the default): the platform pair spends nothing.
  await withEnv(Object.assign({}, NO_PLATFORM, { HIGGSFIELD_API_KEY: 'kid-plat', HIGGSFIELD_API_SECRET: 'ksec-plat', FREE_GENERATION: null }), async () => {
    const n = higgsfield();
    try {
      const vc = loadVC(null);
      const out = await vc.generateVideo({ prompt: 'Slow push in', brand: { name: 'Fernwick Roasters' } });
      expect(out.provider).toBe('code-motion');
      expect(n.calls.length).toBe(0);
    } finally { n.restore(); delete require.cache[VC]; }
  });
  // Free generation off: the platform pair renders, not recorded as own.
  await withEnv(Object.assign({}, NO_PLATFORM, { HIGGSFIELD_API_KEY: 'kid-plat', HIGGSFIELD_API_SECRET: 'ksec-plat', FREE_GENERATION: 'off' }), async () => {
    let n = higgsfield();
    try {
      const vc = loadVC(null);
      const out = await vc.generateVideo({ prompt: 'Slow push in', motion: { images: [PHOTO] } });
      expect(out).toMatchObject({ ok: true, provider: 'higgsfield', own: false });
      expect(n.calls[0].headers.Authorization).toBe('Key kid-plat:ksec-plat');
    } finally { n.restore(); }
    // The person's own key goes first, and the platform's is not tried after it.
    n = higgsfield({ submit: (c) => (c.headers.Authorization === 'Key kid-own:ksec-own' ? { status: 429, body: { detail: 'account_queue_full' } } : { body: { status: 'queued', request_id: 'plat' } }) });
    try {
      const vc = loadVC(OWN);
      const out = await vc.generateVideo({ prompt: 'Slow push in', brand: { name: 'Fernwick Roasters' } });
      expect(n.calls.map((c) => c.headers.Authorization)).toEqual(['Key kid-own:ksec-own']);
      expect(out.provider).toBe('code-motion');
    } finally { n.restore(); delete require.cache[VC]; }
  });
  // A key id with no secret is not a credential.
  await withEnv(Object.assign({}, NO_PLATFORM, { HIGGSFIELD_API_KEY: 'kid-plat', FREE_GENERATION: 'off' }), async () => {
    const n = higgsfield();
    try {
      const vc = loadVC({ higgsfield: { api_key: 'kid-own' } });
      const out = await vc.generateVideo({ prompt: 'Slow push in', only: 'higgsfield' });
      expect(out.error).toBe('no_higgsfield_key');
      expect(vc.isConnected()).toBe(false);
      expect(n.calls.length).toBe(0);
    } finally { n.restore(); delete require.cache[VC]; }
  });
});

test('the connection Test prices a request at /estimate and starts no render', async () => {
  const n = higgsfield({ estimate: (c) => (c.headers.Authorization === 'Key kid:sec' ? { body: { usd: '0.40' } } : { status: 401, body: { detail: 'Invalid credentials' } }) });
  try {
    const vc = loadVC(null);
    expect(await vc.higgsfieldEstimate('kid', 'sec')).toEqual({ ok: true, usd: '0.40' });
    const bad = await vc.higgsfieldEstimate('kid', 'wrong');
    expect(bad).toMatchObject({ ok: false, status: 401 });
    expect(n.calls.every((c) => c.url.startsWith(HF + '/estimate/'))).toBe(true);
    // The registry offers it as a media connection with both halves secret.
    const reg = require(WC).BY_ID.get('higgsfield');
    expect(reg).toMatchObject({ category: 'media', env_default: '' });
    expect(reg.fields.map((f) => [f.key, f.secret, f.required])).toEqual([['api_key', true, true], ['api_secret', true, true]]);
  } finally { n.restore(); delete require.cache[VC]; }
});

/* ── The /brain button, in Chromium ───────────────────────────────────── */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let server; let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, workspaces: [] })); }
    const f = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

test('/brain: "Render with Seedance" sends the first shot\'s photo and move to Higgsfield and plays the MP4 it returns', async ({ page }) => {
  test.setTimeout(60000);
  const sent = [];
  await page.route('**/api/brain?action=video-generate**', async (r) => {
    sent.push(JSON.parse(r.request().postData() || '{}'));
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, provider: 'higgsfield', job_id: 'req-9', status: 'processing', mode: 'image-to-video' }) });
  });
  await page.route('**/api/brain?action=video-status**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, provider: 'higgsfield', job_id: 'req-9', status: 'completed', video_url: base + '/no-such.mp4' }) }));
  await page.goto(base + '/smart-brain.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof renderAd === 'function' && typeof window.sbRenderSeedance === 'function', null, { timeout: 20000 });
  const motion = require(path.join(ROOT, 'scripts', 'lib', 'motion-ad.js'));
  const brief = motion.motionBrief({ brand: { name: 'Fernwick Roasters' }, product: 'House blend', scenes: [{ image: PHOTO, headline: 'Roasted on Tuesdays' }], cta: 'Shop now' });
  await page.evaluate((brief) => {
    const host = document.createElement('div'); host.id = 'hf-host'; document.body.appendChild(host);
    host.innerHTML = renderAd({ platform: 'meta', creative_type: 'video', cta: 'Shop now', creative: { motion_html: '<!doctype html><p>x</p>', motion_brief: brief } });
  }, brief);
  const btn = page.locator('#hf-host [data-seedance]');
  await expect(btn).toHaveText(/Render with Seedance \(Higgsfield\)/);
  await btn.click();
  await expect(page.locator('#hf-host [data-seedance-out] video')).toHaveAttribute('src', base + '/no-such.mp4', { timeout: 20000 });
  await expect(page.locator('#hf-host [data-seedance-out] a')).toContainText('Higgsfield keeps it 7 days');
  expect(sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ provider: 'higgsfield', image: PHOTO, aspect: '9:16', resolution: '720p' });
  expect(sent[0].prompt).toContain(brief.shots[0].video_prompt);
  expect(sent[0].prompt).toContain('The product: House blend.');
  // The rules are added on the server, to the Seedance request alone.
  expect(sent[0].prompt).not.toContain('<render_rules>');
});

test('/brain: an ad with no product photo sends nothing to Seedance and says why', async ({ page }) => {
  const sent = [];
  await page.route('**/api/brain?action=video-generate**', (r) => { sent.push(1); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  await page.goto(base + '/smart-brain.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof renderAd === 'function' && typeof window.sbRenderSeedance === 'function', null, { timeout: 20000 });
  await page.evaluate(() => {
    const host = document.createElement('div'); host.id = 'hf-host'; document.body.appendChild(host);
    host.innerHTML = renderAd({ platform: 'meta', creative_type: 'video', creative: { motion_html: '<p>x</p>', motion_brief: { product: 'House blend', shots: [{ source_image: '[generate via /api/ai/image mode=reels]', video_prompt: 'Cinematic push in over the provided frame' }] } } });
  });
  await page.locator('#hf-host [data-seedance]').click();
  await expect(page.locator('#hf-host [data-seedance-out]')).toHaveText(/no product photo, so nothing was sent to Seedance/);
  expect(sent.length).toBe(0);
});

test('/brain: with no Higgsfield key the button says how to connect one', async ({ page }) => {
  await page.route('**/api/brain?action=video-generate**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'no_higgsfield_key', message: 'Connect Higgsfield on Connections (your key id and secret from cloud.higgsfield.ai) to render this with Seedance 2.0.' }) }));
  await page.goto(base + '/smart-brain.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof renderAd === 'function' && typeof window.sbRenderSeedance === 'function', null, { timeout: 20000 });
  await page.evaluate(() => {
    const host = document.createElement('div'); host.id = 'hf-host'; document.body.appendChild(host);
    host.innerHTML = renderAd({ platform: 'meta', creative_type: 'video', creative: { motion_html: '<p>x</p>', motion_brief: { product: 'House blend', shots: [{ source_image: 'https://shop.example/a.jpg', video_prompt: 'Slow push in' }] } } });
  });
  await page.locator('#hf-host [data-seedance]').click();
  await expect(page.locator('#hf-host [data-seedance-out]')).toHaveText(/Connect Higgsfield on Connections/);
  await expect(page.locator('#hf-host [data-seedance]')).toBeEnabled();
});
