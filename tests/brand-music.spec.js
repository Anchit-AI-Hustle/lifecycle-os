// Brand music: a track for a product, a sale or the brand itself, at Gemini's
// quality, and the track in Smart Brain's Story video (2026-10-25).
//
// The operator: "integrate the music studio feature from the Third Eye Jarvis
// agent repo ... to create music for brands in particular. It could be for
// particular products, for particular sales, anything. Also add music creation
// in the smart brain", with a Gemini-made product video as the bar: "output
// needs to match this quality as on Gemini".
//
// Executed: the shipped planner (brand-music.js), the shipped compose chain
// (music-compose.js) over a fetch that answers exactly the documented Lyria
// Interactions request and throws on anything else, Smart Brain's shipped
// buildCampaign, and the Story video in Chromium: a composed track handed in by
// message plays with it and is RECORDED into the saved file (ffprobe reads an
// audio stream in it).
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BM = require(path.join(ROOT, 'api', '_shared', 'brand-music.js'));
const MC_PATH = path.join(ROOT, 'api', '_shared', 'music-compose.js');
const LYRIA = 'https://generativelanguage.googleapis.com/v1beta/interactions';

const BAKERY = {
  name: 'Nik Bakers', industry: 'Bakery', tagline: 'The upgrade you feel every day',
  claims: ['Freshly baked every morning', 'Hurry, last chance today'],
  voice: { tone: 'warm, homely', banned: ['last chance'] },
};

/** Every sung line is made of the brand's own words, the product's name or the typed offer. */
function lyricLines(lyrics) {
  return String(lyrics || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^\[.*\]$/.test(l));
}

test('the brief is the brand\'s own: purpose, genre from its industry, and lyrics only in words it stated', () => {
  const offer = '20% off all cakes this weekend';
  expect(BM.plan({ brand: BAKERY, purpose: 'sale' }).seconds).toBe(20);
  // 30 seconds: long enough for a verse, so the brand's claims are sung too.
  const p = BM.plan({ brand: BAKERY, purpose: 'sale', offer, vocals: true, product: { title: 'Chocolate Truffle Cake' }, market: 'in', seconds: 30 });
  expect(p.purpose).toBe('sale');
  expect(p.genre).toBe('warm acoustic');
  expect(p.lyrics).toContain('[Verse]');
  expect(p.lyrics).toContain('Freshly baked every morning');
  expect(p.prompt).toMatch(/^Create an original warm acoustic track, about 30 seconds long\./);
  expect(p.prompt).toContain('For the brand Nik Bakers (Bakery).');
  expect(p.prompt).toContain('It promotes this offer: ' + offer);
  expect(p.prompt).toContain('Home market: IN.');
  expect(p.prompt).toMatch(/Do not imitate any named artist, voice or existing song/);
  expect(p.prompt).not.toMatch(/[–—]/);
  const allowed = [BAKERY.name, BAKERY.tagline, 'Chocolate Truffle Cake', offer].concat(BAKERY.claims);
  for (const line of lyricLines(p.lyrics)) {
    const parts = line.split(/,\s*/);
    for (const part of parts) expect(allowed.some((a) => a.toLowerCase() === part.toLowerCase()), `"${part}" is not the brand's own words`).toBe(true);
  }
  expect(p.lyrics, 'a banned phrase was sung').not.toMatch(/last chance/i);
  expect(p.prompt).toContain('Sing exactly these lyrics');

  // A product, no offer: the product's name, never an invented one; a model code is the range's name.
  const q = BM.plan({ brand: BAKERY, product: { title: 'Vincent Chase VC 5158/P' }, vocals: true });
  expect(q.purpose).toBe('product');
  expect(q.lyrics).toContain('Vincent Chase');
  expect(q.lyrics).not.toContain('5158');

  // An ad bed and a film underscore never sing; a sonic logo is a few seconds.
  expect(BM.plan({ brand: BAKERY, purpose: 'ad_bed', vocals: true }).vocals).toBe(false);
  expect(BM.plan({ brand: BAKERY, purpose: 'film', vocals: true }).prompt).toContain('Instrumental only, no vocals.');
  const logo = BM.plan({ brand: BAKERY, purpose: 'sonic_logo' });
  expect(logo.seconds).toBe(6);
  expect(logo.structure).toMatch(/Motif/);
  // A jingle sings by default; the operator's own lyrics are kept as typed.
  const j = BM.plan({ brand: BAKERY, purpose: 'jingle', lyrics: '[Hook]\nBaked at dawn by Nik Bakers' });
  expect(j.vocals).toBe(true);
  expect(j.lyrics_source).toBe('typed');
  expect(j.prompt).toContain('Baked at dawn by Nik Bakers');
  // Genre follows the industry; the operator's pick wins.
  expect(BM.genreFor({ industry: 'Sneaker customisation' })).toBe('hip-hop');
  expect(BM.genreFor({ industry: 'Eyewear retail' })).toBe('modern pop');
  expect(BM.plan({ brand: BAKERY, genre: 'Bollywood pop' }).genre).toBe('bollywood pop');
  // The browser loads the same file.
  expect(fs.readFileSync(path.join(ROOT, 'brand-music.js'), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'api', '_shared', 'brand-music.js'), 'utf8'));
});

function fakeLyria(answer) {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    const out = answer(u, init, calls.length);
    if (!out) throw new Error('unrouted request: ' + u);
    return new Response(typeof out.body === 'string' ? out.body : JSON.stringify(out.body), { status: out.status || 200, headers: { 'content-type': out.type || 'application/json' } });
  };
  return { calls, restore: () => { global.fetch = real; } };
}
const MP3 = Buffer.alloc(9000, 7);
const SONG = { id: 'i1', steps: [{ type: 'user_input' }, { type: 'model_output', content: [{ type: 'text', text: '[Hook]\nNik Bakers' }, { type: 'audio', data: MP3.toString('base64'), mime_type: 'audio/mpeg' }] }] };

function fresh() { delete require.cache[MC_PATH]; return require(MC_PATH); }
function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  return Promise.resolve(fn()).finally(() => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
}

test('a workspace\'s own Gemini key composes with Lyria first: the documented request, the clip model for 30 s, the song model past it', async () => {
  const net = fakeLyria((u) => (u === LYRIA ? { body: SONG } : null));
  try {
    await withEnv({ GEMINI_API_KEY: undefined, ELEVENLABS_API_KEY: undefined }, async () => {
      const MC = fresh();
      const r = await MC.compose({ prompt: 'A warm acoustic sale track', seconds: 20 }, { own: { apiKey: 'own-key' }, freeGeneration: true });
      expect(r.ok).toBe(true);
      expect(r.provider).toBe('lyria');
      expect(r.quality).toBe('studio');
      expect(r.own).toBe(true);
      expect(r.audio.equals(MP3)).toBe(true);
      expect(r.sung).toContain('Nik Bakers');
      expect(net.calls[0]).toMatchObject({ url: LYRIA, headers: { 'x-goog-api-key': 'own-key' }, body: { model: 'lyria-3-clip-preview', input: 'A warm acoustic sale track' } });
      await MC.compose({ prompt: 'An anthem', seconds: 60 }, { own: { apiKey: 'own-key' }, freeGeneration: true });
      expect(net.calls[1].body.model).toBe('lyria-3.5');
      // Signed in with Google: the access token and its project, no key header.
      await MC.compose({ prompt: 'A jingle', seconds: 30 }, { own: { bearer: 'ya29.token', project: 'my-proj' }, freeGeneration: true });
      expect(net.calls[2].headers).toMatchObject({ Authorization: 'Bearer ya29.token', 'x-goog-user-project': 'my-proj' });
      expect(net.calls[2].headers['x-goog-api-key']).toBeUndefined();
    });
  } finally { net.restore(); }
});

test('a refusal is said: the own key refused falls to the platform key; both refused gives a labelled sketch, never silence', async () => {
  let n = 0;
  const net = fakeLyria((u) => {
    if (u !== LYRIA) return null;
    n += 1;
    return n === 1 ? { status: 429, body: { error: { message: 'Lyria is not available on the free tier' } } } : { body: SONG };
  });
  try {
    await withEnv({ GEMINI_API_KEY: 'platform-key', ELEVENLABS_API_KEY: undefined, LYRIA_PLATFORM: undefined }, async () => {
      const MC = fresh();
      const r = await MC.compose({ prompt: 'A product film track', seconds: 30 }, { own: { apiKey: 'own-free' }, freeGeneration: true });
      expect(r.ok).toBe(true);
      expect(r.own).toBe(false);
      expect(net.calls.map((c) => c.headers['x-goog-api-key'])).toEqual(['own-free', 'platform-key']);
      expect(r.refusals[0]).toMatch(/Your Gemini connection: Lyria needs a Gemini API key on a paid/);
    });
    n = -100; // every answer from now on refuses
    const net2 = fakeLyria((u) => (u === LYRIA ? { status: 429, body: { error: { message: 'quota' } } } : null));
    try {
      await withEnv({ GEMINI_API_KEY: 'platform-key', ELEVENLABS_API_KEY: undefined }, async () => {
        const r = await fresh().compose({ prompt: 'A product film track at 96 BPM', seconds: 15 }, { own: null, freeGeneration: true });
        expect(r.ok).toBe(true);
        expect(r.provider).toBe('code-synth');
        expect(r.quality).toBe('sketch');
        expect(r.mime).toBe('audio/wav');
        expect(r.message).toMatch(/sketch, not a produced track/);
        expect(r.message).toMatch(/platform's Gemini key: Lyria needs/);
      });
    } finally { net2.restore(); }
    // LYRIA_PLATFORM=off: the platform's key is not spent.
    const net3 = fakeLyria(() => null);
    try {
      await withEnv({ GEMINI_API_KEY: 'platform-key', LYRIA_PLATFORM: 'off', ELEVENLABS_API_KEY: undefined }, async () => {
        const r = await fresh().compose({ prompt: 'x', seconds: 15 }, { own: null, freeGeneration: true });
        expect(r.provider).toBe('code-synth');
        expect(net3.calls).toEqual([]);
      });
    } finally { net3.restore(); }
    // Free generation off and no music model at all: the sentence names what to set.
    await withEnv({ GEMINI_API_KEY: undefined, ELEVENLABS_API_KEY: undefined }, async () => {
      const r = await fresh().compose({ prompt: 'x', seconds: 15 }, { own: null, freeGeneration: false });
      expect(r.status).toBe(501);
      expect(r.message).toMatch(/Gemini key on AI Models/);
      expect(r.message).toMatch(/ELEVENLABS_API_KEY/);
    });
  } finally { net.restore(); }
});

test('Smart Brain plans the track of every send: a sale for an offer, else the product, as long as its Story video', async () => {
  const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION'];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  const BR = { id: 'device:bake', slug: 'nik', name: 'Nik Bakers', industry: 'Bakery', website: 'https://www.nik.example', tagline: 'The upgrade you feel every day',
    palette: { primary: '#832622', accent: '#f15a24', ink: '#2a1a12', surface: '#ffffff' }, regions: [{ code: 'IN', currency: 'INR', store_url: 'https://www.nik.example', home: true }] };
  const P = (t, n, price) => ({ sku: 'S' + n, title: t, handle: 'p' + n, image: `https://cdn.nik.example/${n}.jpg`, price, url: `https://www.nik.example/p${n}.html` });
  const slot = (offer) => ({ id: 'nb-' + (offer ? 'o' : 'p'), date: '2026-10-28', market: 'IN', objective: 'reactivation', brand: BR,
    cohort: { name: 'At Risk', size: null, estimated: true }, channels: ['email', 'meta', 'landing_page'], confidence: 0.6, offer,
    heroProduct: P('Chocolate Truffle Cake', 1, 899), supportingProducts: [P('Multigrain Loaf', 2, 120)] });
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const SB = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
    const a = await SB.buildCampaign(slot({ depth: 'none', pct: 0 }), smartConfig({}), { noLLM: true, withCreatives: false });
    const m = a.assets.music;
    expect(m, 'no music on the campaign').toBeTruthy();
    expect(m.purpose).toBe('product');
    expect(m.genre).toBe('warm acoustic');
    expect(m.prompt).toContain('It is for the product "Chocolate Truffle Cake".');
    expect(m.image_url).toBe('https://cdn.nik.example/1.jpg');
    const story = (a.assets.ads || []).find((x) => x.creative && x.creative.story_brief);
    if (story) expect(m.seconds).toBe(Math.ceil(story.creative.story_brief.duration_s));
    expect(m.vocals).toBe(false);
    const b = await SB.buildCampaign(slot({ depth: 'light', pct: 15, code: 'BAKE15' }), smartConfig({}), { noLLM: true, withCreatives: false });
    expect(b.assets.music.purpose).toBe('sale');
    expect(b.assets.music.prompt).toContain('It promotes this offer: 15% off with code BAKE15.');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#c58b5a"/></svg>';

test('the Story video takes the composed track by message, plays it and records it into the saved file', async ({ page }) => {
  test.setTimeout(120_000);
  const SA = require(path.join(ROOT, 'scripts', 'lib', 'story-ad.js'));
  const html = SA.renderStoryAd({
    brand: { name: 'Nik Bakers' }, brandName: 'Nik Bakers', hook: 'Freshly baked', lines: ['The upgrade you feel every day'],
    products: [{ title: 'Chocolate Truffle Cake', price_text: '₹899', image: 'https://cdn.nik.example/1.jpg' }],
    images: ['https://cdn.nik.example/1.jpg'], cta: 'Shop now', store: 'https://www.nik.example', endLine: 'Nik Bakers',
    palette: { primary: '#832622', on_primary: '#ffffff', accent: '#ffffff', on_accent: '#832622', surface: '#ffffff', ink: '#2a1a12' },
    fonts: { head: 'Georgia, serif', body: 'Arial, sans-serif' },
  });
  const wav = Buffer.from(require(path.join(ROOT, 'music-synth.js')).renderBytes('Warm acoustic at 96 BPM', 30, { compact: true }).bytes);
  await page.route('**/*', (r) => (r.request().resourceType() === 'image'
    ? r.fulfill({ contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: PHOTO })
    : r.continue()));
  await page.route('https://story.test/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://story.test/');
  await page.click('#restart');
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    window.postMessage({ type: 'lifecycle-story-track', blob: new Blob([bytes], { type: 'audio/wav' }), label: 'Nik Bakers sale' }, '*');
  }, wav.toString('base64'));
  await expect(page.locator('html')).toHaveAttribute('data-track', 'on');
  await expect(page.locator('#note')).toContainText('Music: Nik Bakers sale');
  // A short cut keeps the recording quick; the track restarts with it.
  if (await page.locator('#cut').count()) await page.click('#cut');
  const dl = page.waitForEvent('download', { timeout: 90_000 });
  await page.click('#save');
  await expect(page.locator('#note')).toContainText('with music');
  const d = await dl;
  const file = await d.path();
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]).toString();
  expect(probe, 'the saved video has no sound').toMatch(/audio/);
  expect(probe).toMatch(/video/);
});
