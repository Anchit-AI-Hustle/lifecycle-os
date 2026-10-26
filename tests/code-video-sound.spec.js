// The code-made video has SOUND and a human hand (2026-10-26).
// The operator: "audio missing in the video assets - ensure it is there too -
// could be background music with human voiceovers", then, with the "Kill the
// AI Tell" card: "ensure complete human touch".
//
// Executed: story-voice.js over fake ElevenLabs / Gemini TTS endpoints that
// answer only the documented request; code-video.soundFor's order (own keys,
// then the platform's only for a signed-in caller, metered); a real render
// whose file is decoded again in Chromium and its AUDIO measured (the voice
// heard at its scene, the music under it, the fade); the H.264 MP4 from the
// production browser carrying AAC; and the Story frame's human touch measured
// in pixels (phone-camera light, the reframe in the first 3 s, grain, the
// text held still).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
// These renders check what the file holds, not how fast it was made: a CI
// runner shares its CPUs between workers, so they get room the 120 s function
// does not (the time limit has its own tests, with the real budget).
const CI_BUDGET = 240000;
const CV = require(path.join(ROOT, 'api', '_shared', 'code-video.js'));
const SA = require(path.join(ROOT, 'scripts', 'lib', 'story-ad.js'));
const SV = require(path.join(ROOT, 'api', '_shared', 'story-voice.js'));
const MB_SRC = fs.readFileSync(path.join(ROOT, 'node_modules', 'mediabunny', 'dist', 'bundles', 'mediabunny.min.cjs'), 'utf8');

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const at = typeof rgb === 'function' ? rgb : () => rgb;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3, c = at(x, y); raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; }
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// A "voice" a test can find again: a 1 kHz tone, as a WAV a browser decodes.
function toneWav(sec, hz, amp) {
  const r = 24000, n = Math.round(sec * r), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(r, 24); b.writeUInt32LE(r * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / r) * (amp || 14000)), 44 + i * 2);
  return b;
}
const STORY = () => SA.renderStoryAd({ brand: { name: 'Oak Bakers' }, brandName: 'Oak Bakers', hook: 'Fresh this week',
  palette: { primary: '#832622', on_primary: '#ffffff', accent: '#ffffff', on_accent: '#2a1a12', surface: '#ffffff', ink: '#2a1a12' },
  products: [{ title: 'Rye Loaf', price_text: '£9' }, { title: 'Seed Loaf', price_text: '£10' }], lines: ['Baked at dawn'], cta: 'Order now' });

/* ── the words spoken ───────────────────────────────────────────────────── */

test('the voiceover is the ad\'s own words, scene by scene, each said once; no marker, address or dash is spoken', () => {
  const d = SA.storyDataFrom(STORY());
  const full = SV.linesFor(d, 'full');
  expect(full.map((l) => [l.kind, l.text])).toEqual([['hook', 'Fresh this week.'], ['product', 'Rye Loaf, £9.'], ['product', 'Seed Loaf, £10.'], ['line', 'Baked at dawn.'], ['end', 'Order now.']]);
  full.forEach((l, i) => { if (i) expect(l.start).toBeGreaterThan(full[i - 1].start); });
  if (d.cuts.short) expect(SV.linesFor(d, 'short').length).toBeLessThanOrEqual(full.length);
  expect(SV.speakable('[DATA REQUIRED BEFORE LAUNCH: price, x, IN]')).toBe('');
  expect(SV.speakable('Shop at https://oak.example/rye now')).toBe('Shop at now.');
  expect(SV.speakable('Fresh — warm – today')).toBe('Fresh, warm, today.');
  expect(SV.speakable('Done!')).toBe('Done!');
  expect(SV.speakable('x'.repeat(400))).toHaveLength(220);
  expect(SV.linesFor(null)).toEqual([]);
});

/* ── who speaks ─────────────────────────────────────────────────────────── */

function fakeVoices(o) {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    if (url.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
      if (o.eleven === 'refuse') return new Response(JSON.stringify({ detail: { status: 'quota_exceeded', message: 'quota' } }), { status: 401 });
      return new Response(toneWav(0.8, 1000), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }
    if (url === SV.INTERACTIONS) {
      if (o.gemini === 'refuse') return new Response(JSON.stringify({ error: { message: 'Quota exceeded for free tier' } }), { status: 429 });
      return new Response(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: toneWav(0.8, 1000).toString('base64') }] }] }), { status: 200 });
    }
    throw new Error('undocumented request: ' + url);
  };
  return { f, calls };
}
async function withEnv(env, fn) {
  const saved = {}; for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const NOKEY = { ELEVENLABS_API_KEY: undefined, ELEVEN_API_KEY: undefined, XI_API_KEY: undefined, GEMINI_API_KEY: undefined, ELEVENLABS_VOICE_ID: undefined };

test.describe('soundFor: the voice and the music', () => {
  test('the workspace\'s own ElevenLabs speaks first: the documented request, a person\'s settings, each line with its neighbours', async () => {
    await withEnv(NOKEY, async () => {
      const d = SA.storyDataFrom(STORY());
      const v = fakeVoices({});
      const s = await CV.soundFor(d, 'full', { ownKeys: { elevenlabs: 'own-eleven' }, fetchImpl: v.f, take: 't' });
      expect([s.voice_provider, s.voice_own, s.voice.length]).toEqual(['elevenlabs', true, 5]);
      expect(s.voiceLabel).toBe('voiceover by ElevenLabs (your key)');
      const c = v.calls;
      expect(c.every((x) => x.url === 'https://api.elevenlabs.io/v1/text-to-speech/' + SV.ELEVEN_VOICE + '?output_format=mp3_44100_128')).toBe(true);
      expect(c.every((x) => x.headers['xi-api-key'] === 'own-eleven')).toBe(true);
      expect(c.map((x) => x.body.text)).toEqual(SV.linesFor(d, 'full').map((l) => l.text));
      expect(c[0].body).toMatchObject({ model_id: 'eleven_multilingual_v2', voice_settings: SV.ELEVEN_SETTINGS, next_text: 'Rye Loaf, £9.' });
      expect(c[0].body.previous_text).toBeUndefined();
      expect(c[1].body).toMatchObject({ previous_text: 'Fresh this week.', next_text: 'Seed Loaf, £10.' });
      expect(c[4].body.next_text).toBeUndefined();
      // A person, not an announcer: below the default stability, some style.
      expect(SV.ELEVEN_SETTINGS.stability).toBeLessThan(0.5);
      expect(SV.ELEVEN_SETTINGS.style).toBeGreaterThan(0);
      expect(s.music.label).toMatch(/^code-made music \(/);
      expect(s.music.mime).toBe('audio/wav');
    });
  });

  test('own ElevenLabs refused: own Gemini TTS speaks, with a voice-note style; the refusal is said', async () => {
    await withEnv(NOKEY, async () => {
      const d = SA.storyDataFrom(STORY());
      const v = fakeVoices({ eleven: 'refuse' });
      const s = await CV.soundFor(d, 'full', { ownKeys: { elevenlabs: 'own-eleven', gemini: { bearer: 'ya29.t', project: 'p1' } }, fetchImpl: v.f });
      expect([s.voice_provider, s.voice_own]).toEqual(['gemini', true]);
      expect(s.voice_refusals.join(' ')).toMatch(/^Your ElevenLabs: ElevenLabs refused the key \(401\)/);
      const g = v.calls.filter((x) => x.url === SV.INTERACTIONS);
      expect(g).toHaveLength(5);
      expect(g[0].headers).toMatchObject({ Authorization: 'Bearer ya29.t', 'x-goog-user-project': 'p1' });
      expect(g[0].body).toEqual({ model: SV.GEMINI_TTS, input: [{ type: 'user_input', content: [{ type: 'text', text: 'Fresh this week.', annotations: [{ type: 'speech_metadata', style: SV.STYLE }] }] }],
        response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice: SV.GEMINI_VOICE }] } });
      expect(SV.STYLE).toMatch(/voice note/); expect(SV.STYLE).toMatch(/never an announcer/i);
    });
  });

  test('the platform\'s voice: never for a caller who is not signed in; metered for one who is; released when it fails', async () => {
    await withEnv(Object.assign({}, NOKEY, { ELEVENLABS_API_KEY: 'plat-eleven' }), async () => {
      const d = SA.storyDataFrom(STORY());
      let v = fakeVoices({});
      let s = await CV.soundFor(d, 'full', { ownKeys: {}, platform: false, fetchImpl: v.f });
      expect(s.voice).toEqual([]); expect(v.calls).toEqual([]);
      expect(s.voice_refusals.join(' ')).toMatch(/for a signed-in account/);
      expect(s.music).toBeTruthy();
      // Signed in: the meter is asked for the characters spoken, settled on success.
      const log = [];
      const meter = async (chars) => { log.push(['hold', chars]); return { ok: true, settle: async () => log.push(['settle']), release: async () => log.push(['release']) }; };
      v = fakeVoices({});
      s = await CV.soundFor(d, 'full', { ownKeys: {}, platform: true, meter, fetchImpl: v.f });
      expect([s.voice_provider, s.voice_own]).toEqual(['elevenlabs', false]);
      expect(s.voiceLabel).toBe('voiceover by ElevenLabs');
      const chars = SV.linesFor(d, 'full').reduce((n, l) => n + l.text.length, 0);
      expect(log).toEqual([['hold', chars], ['settle']]);
      expect(v.calls.every((x) => x.headers['xi-api-key'] === 'plat-eleven')).toBe(true);
      // The platform's voice refuses: the hold is released, the reason said.
      log.length = 0; v = fakeVoices({ eleven: 'refuse' });
      s = await CV.soundFor(d, 'full', { ownKeys: {}, platform: true, meter, fetchImpl: v.f });
      expect(s.voice).toEqual([]); expect(log).toEqual([['hold', chars], ['release']]);
      expect(s.voice_refusals.join(' ')).toMatch(/The platform's ElevenLabs: /);
      // The meter refuses (no credits): nothing is sent to the voice.
      v = fakeVoices({});
      s = await CV.soundFor(d, 'full', { ownKeys: {}, platform: true, meter: async () => ({ ok: false, message: 'There are not enough credits for the voiceover.' }), fetchImpl: v.f });
      expect(v.calls).toEqual([]); expect(s.voice_refusals).toContain('There are not enough credits for the voiceover.');
    });
  });

  test('no key anywhere: music only, and the reply says how to add a voice; a composed track is the bed; either can be switched off', async () => {
    await withEnv(NOKEY, async () => {
      const d = SA.storyDataFrom(STORY());
      const v = fakeVoices({});
      let s = await CV.soundFor(d, 'full', { ownKeys: {}, platform: true, fetchImpl: v.f, take: 'a' });
      expect(s.voice).toEqual([]); expect(v.calls).toEqual([]);
      expect(s.voice_refusals.join(' ')).toMatch(/connect your own ElevenLabs or Gemini key/);
      // The code-made bed covers the whole video, and another take is another bed.
      const SY = require(path.join(ROOT, 'music-synth.js'));
      expect(s.music.bytes.readUInt32LE(40)).toBe(Math.ceil(d.cuts.full.total) * 44100 * 4);
      const other = await CV.soundFor(d, 'full', { ownKeys: {}, fetchImpl: v.f, take: 'b' });
      expect(Buffer.compare(s.music.bytes, other.music.bytes)).not.toBe(0);
      // The slot's own music brief chooses the bed's band.
      const acoustic = await CV.soundFor(d, 'full', { ownKeys: {}, fetchImpl: v.f, musicPrompt: 'Create an original warm acoustic track for Oak Bakers.' });
      expect(acoustic.music.label).toBe('code-made music (acoustic)');
      expect(SY.STYLES.acoustic).toBeTruthy();
      // A composed track is used as it came.
      const mine = Buffer.alloc(5000, 9);
      s = await CV.soundFor(d, 'full', { ownKeys: {}, fetchImpl: v.f, music: { bytes: mine, mime: 'audio/mpeg' } });
      expect(s.music).toEqual({ bytes: mine, mime: 'audio/mpeg', label: 'your composed track' });
      s = await CV.soundFor(d, 'full', { ownKeys: { elevenlabs: 'k' }, fetchImpl: v.f, voiceOff: true, musicOff: true });
      expect([s.music, s.voice]).toEqual([null, []]);
    });
  });

  test('the words of a refusal: a key, a quota, a scope, a timeout', async () => {
    expect(SV.reasonOf('ElevenLabs', 401, '{"detail":{"message":"bad key"}}')).toBe('ElevenLabs refused the key (401): bad key');
    expect(SV.reasonOf('Gemini TTS', 429, '{"error":{"message":"Quota exceeded"}}')).toMatch(/no quota left on this key \(429\)/);
    expect(SV.reasonOf('Gemini TTS', 403, '{"error":{"message":"Request had insufficient authentication scopes."}}')).toMatch(/sign in with Google again/);
    const hang = async (u, i) => new Promise((_ok, no) => i.signal.addEventListener('abort', () => no(new Error('aborted'))));
    await expect(SV.speakEleven('hi', 'k', { fetchImpl: hang, timeoutMs: 1200 })).rejects.toThrow('ElevenLabs did not answer in time');
    await expect(SV.speakGemini('hi', { apiKey: 'k' }, { fetchImpl: hang, timeoutMs: 1200 })).rejects.toThrow('Gemini TTS did not answer in time');
    await expect(SV.speakGemini('hi', { apiKey: 'k' }, { fetchImpl: async () => new Response('{"steps":[]}', { status: 200 }) })).rejects.toThrow('without audio');
    await expect(SV.speakEleven('hi', 'k', { fetchImpl: async () => new Response('x', { status: 200 }) })).rejects.toThrow('without audio');
  });
});

/* ── the file: sound heard in it ────────────────────────────────────────── */

async function decodeAudio(page, buf, mime) {
  await page.route('https://inspect.invalid/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/v') return route.fulfill({ status: 200, contentType: mime, body: buf });
    if (u.pathname === '/mb.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: MB_SRC });
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>i</title>' });
  });
  await page.goto('https://inspect.invalid/');
  await page.addScriptTag({ url: 'https://inspect.invalid/mb.js' });
  return page.evaluate(async () => {
    const M = window.Mediabunny;
    const input = new M.Input({ source: new M.BufferSource(await (await fetch('/v')).arrayBuffer()), formats: M.ALL_FORMATS });
    const tr = await input.getPrimaryAudioTrack();
    if (!tr) return { track: false };
    const out = { track: true, codec: tr.codec, rate: tr.sampleRate, channels: tr.numberOfChannels, duration: await tr.computeDuration() };
    const sink = new M.AudioBufferSink(tr);
    const rate = tr.sampleRate, mono = [];
    for await (const w of sink.buffers()) {
      const b = w.buffer, d = b.getChannelData(0);
      const off = Math.round(w.timestamp * rate);
      for (let i = 0; i < d.length; i++) mono[off + i] = d[i];
    }
    const at = (a, z) => mono.slice(Math.round(a * rate), Math.round(z * rate)).map((x) => x || 0);
    const rms = (s) => Math.sqrt(s.reduce((n, x) => n + x * x, 0) / Math.max(1, s.length));
    // Goertzel at 1 kHz: how much of the window is the voice's tone.
    const tone = (s) => { const k = 2 * Math.cos(2 * Math.PI * 1000 / rate); let p = 0, q = 0; for (const x of s) { const v = x + k * p - q; q = p; p = v; } return Math.sqrt(p * p + q * q - k * p * q) / Math.max(1, s.length); };
    window.__m = { at, rms, tone };
    return out;
  });
}

test('a render with music and a voice: the file carries the sound, the voice is heard at its scene over ducked music, and it fades out', async ({ page }) => {
  test.setTimeout(300000);
  const d = SA.storyDataFrom(STORY());
  const v = fakeVoices({});
  const s = await withEnv(NOKEY, () => CV.soundFor(d, 'full', { ownKeys: { elevenlabs: 'k' }, fetchImpl: v.f, musicPrompt: 'Create an original calm ambient track.', take: 'z' }));
  const r = await CV.renderStoryVideo({ budgetMs: CI_BUDGET, data: d, size: '540p', audio: { music: s.music, voice: s.voice, voiceLabel: s.voiceLabel }, fetchImpl: async () => { throw new Error('no photos'); }, assertUrl: async () => {} });
  expect(r.ok, r.message).toBe(true);
  expect(r.audio).toMatchObject({ codec: r.container === 'mp4' ? 'AAC' : 'Opus', voice_lines: 5, words: 'code-made music (cinematic) + voiceover by ElevenLabs (your key)' });
  test.skip(r.container === 'mp4', 'this Chromium cannot decode the H.264 file; the production-browser test reads it');
  expect(r.bytes).toBeLessThan(CV.MAX_BYTES_OUT);
  const info = await decodeAudio(page, r.buffer, r.mime);
  expect(info).toMatchObject({ track: true, codec: 'opus', rate: 48000, channels: 2 });
  expect(Math.abs(info.duration - r.seconds)).toBeLessThan(0.15);
  const m = await page.evaluate((lines) => {
    const { at, rms, tone } = window.__m;
    const out = { voiced: [], gaps: [] };
    for (const l of lines) out.voiced.push(tone(at(l.start + 0.35, l.start + 0.9)));
    // Between the second product's line and the next (no voice): the music alone.
    out.bed = rms(at(lines[1].start + 1.3, lines[2].start)); out.bedTone = tone(at(lines[1].start + 1.3, lines[2].start));
    out.voicedRms = rms(at(lines[1].start + 0.35, lines[1].start + 0.9));
    const end = lines.total;
    out.tail = rms(at(end - 0.04, end));
    out.head = rms(at(0, 0.03));
    return out;
  }, Object.assign(SV.linesFor(d, 'full').map((l) => ({ start: l.start })), { total: r.seconds }));
  for (const [i, t] of m.voiced.entries()) expect(t, 'line ' + i + ' is not heard at its scene').toBeGreaterThan(m.bedTone * 4);
  expect(m.bed, 'there is no music bed between the lines').toBeGreaterThan(0.01);
  expect(m.voicedRms).toBeGreaterThan(m.bed);
  expect(m.tail, 'the sound stops dead instead of fading').toBeLessThan(0.05);
  expect(m.head).toBeLessThan(0.05);
});

test('a composed track longer than the video is faded in and out by the mix, never cut dead', async ({ page }) => {
  test.setTimeout(240000);
  const d = SA.storyDataFrom(STORY());
  const total = d.cuts.short ? d.cuts.short.total : d.cuts.full.total;
  // A steady tone that never fades by itself, as a track composed elsewhere may not.
  const r = await CV.renderStoryVideo({ budgetMs: CI_BUDGET, data: d, cut: 'short', size: '540p', audio: { music: { bytes: toneWav(total + 5, 300, 16000), mime: 'audio/wav', label: 'your composed track' }, voice: [] }, fetchImpl: async () => { throw new Error('x'); }, assertUrl: async () => {} });
  expect(r.ok, r.message).toBe(true);
  expect(r.audio.words).toBe('your composed track');
  test.skip(r.container === 'mp4', 'this Chromium cannot decode the H.264 file');
  await decodeAudio(page, r.buffer, r.mime);
  const m = await page.evaluate((T) => { const { at, rms } = window.__m; return { head: rms(at(0, 0.03)), mid: rms(at(T / 2 - 0.5, T / 2 + 0.5)), tail: rms(at(T - 0.05, T)) }; }, r.seconds);
  expect(m.mid).toBeGreaterThan(0.2);
  expect(m.head, 'the track starts at full level').toBeLessThan(m.mid / 4);
  expect(m.tail, 'the track is cut dead at the end').toBeLessThan(m.mid / 4);
});

test('a render with no sound asked is silent and says so; music only is labelled music only', async () => {
  test.setTimeout(240000);
  const d = SA.storyDataFrom(STORY());
  const r = await CV.renderStoryVideo({ budgetMs: CI_BUDGET, data: d, cut: 'short', size: '540p', fetchImpl: async () => { throw new Error('x'); }, assertUrl: async () => {} });
  expect(r.ok, r.message).toBe(true);
  expect(r.audio).toMatchObject({ codec: null, words: 'silent' });
  const s = await withEnv(NOKEY, () => CV.soundFor(d, 'short', { ownKeys: {}, voiceOff: true, take: 'q' }));
  const r2 = await CV.renderStoryVideo({ budgetMs: CI_BUDGET, data: d, cut: 'short', size: '540p', audio: { music: s.music, voice: [] }, fetchImpl: async () => { throw new Error('x'); }, assertUrl: async () => {} });
  expect(r2.ok, r2.message).toBe(true);
  expect(r2.audio.words).toMatch(/^code-made music \(\w+\)$/);
  expect(r2.audio.voice_lines).toBe(0);
});

test('the production browser\'s MP4 carries AAC beside H.264, the codec ad platforms take', async () => {
  test.skip(process.platform !== 'linux' || process.arch !== 'x64', 'the serverless binary is built for Linux x64');
  test.setTimeout(300000);
  const d = SA.storyDataFrom(STORY());
  const v = fakeVoices({});
  const s = await withEnv(NOKEY, () => CV.soundFor(d, 'short', { ownKeys: { elevenlabs: 'k' }, fetchImpl: v.f, take: 'p' }));
  const r = await CV.renderStoryVideo({ budgetMs: CI_BUDGET, data: d, cut: 'short', size: '540p', prefer: 'sparticuz', audio: { music: s.music, voice: s.voice, voiceLabel: s.voiceLabel }, fetchImpl: async () => { throw new Error('x'); }, assertUrl: async () => {} });
  expect(r.ok, r.message).toBe(true);
  expect([r.container, r.codec, r.audio.codec]).toEqual(['mp4', 'H.264', 'AAC']);
  expect(r.buffer.includes(Buffer.from('mp4a'))).toBe(true);
  expect(r.buffer.includes(Buffer.from('esds'))).toBe(true);
  expect(r.buffer.includes(Buffer.from('avc1'))).toBe(true);
  expect(r.bytes).toBeLessThan(CV.MAX_BYTES_OUT);
});

/* ── the human touch, in pixels ─────────────────────────────────────────── */

test('the human touch: phone-camera light on the photo, a reframe in the first 3 s, grain on a flat card, the words held still, every frame repeatable', async ({ page }) => {
  test.setTimeout(120000);
  // A grey photo (mean 180) with fine stripes, so a move of the photo shows in its pixels.
  const GREY = png(200, 300, (x) => ((x >> 1) % 2 ? [200, 200, 200] : [160, 160, 160]));
  const html = SA.renderStoryAd({ brand: { name: 'Oak' }, brandName: 'Oak', hook: 'Fresh this week', palette: { primary: '#832622', on_primary: '#ffffff', accent: '#ffffff', on_accent: '#2a1a12', surface: '#ffffff', ink: '#2a1a12' },
    products: [{ title: 'Rye Loaf', price_text: '£9', image: 'https://img.example/grey.png' }], lines: ['Baked at dawn'], cta: 'Order now' });
  const pageHtml = SA.storyPage(SA.storyDataFrom(html));
  await page.addInitScript(() => { window.__STORY_RENDER = true; });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u === 'https://render.invalid/') return route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml });
    if (u === 'https://img.example/grey.png') return route.fulfill({ status: 200, contentType: 'image/png', body: GREY, headers: { 'Access-Control-Allow-Origin': '*' } });
    return route.abort();
  });
  await page.goto('https://render.invalid/');
  const m = await page.evaluate(async () => {
    const S = window.__story; await S.ready(); S.size(540, 960);
    const cx = S.canvas.getContext('2d');
    const grab = (t) => { S.frame(t); return cx.getImageData(0, 0, 540, 960).data.slice(); };
    const px = (d, x, y) => { const o = (y * 540 + x) * 4; return [d[o], d[o + 1], d[o + 2]]; };
    const avg = (d, x0, y0, x1, y1) => { let r = 0, g = 0, b = 0, n = 0; for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const p = px(d, x, y); r += p[0]; g += p[1]; b += p[2]; n++; } return [r / n, g / n, b / n]; };
    // One warm-up draw: Chromium's first draw of a photo can differ by a byte or
    // two (its decode cache); every draw after it is exact.
    grab(0.8);
    const a = grab(0.8), a2 = grab(0.8);
    let same = true; for (let i = 0; i < a.length; i++) if (a[i] !== a2[i]) { same = false; break; }
    const mid = avg(a, 200, 380, 340, 460);
    const left = avg(a, 20, 300, 120, 420), right = avg(a, 420, 300, 520, 420);
    // The reframe: the photo moves between 1.40 s and 1.52 s more than the drift alone moves it.
    const g1 = grab(1.38), g2 = grab(1.52), d1 = grab(2.6), d2 = grab(2.74);
    const diff = (p, q) => { let n = 0; for (let y = 200; y < 500; y += 3) for (let x = 40; x < 500; x += 3) { const o = (y * 540 + x) * 4; n += Math.abs(p[o] - q[o]) + Math.abs(p[o + 1] - q[o + 1]) + Math.abs(p[o + 2] - q[o + 2]); } return n; };
    // The end card: a flat brand colour, grained (not one perfect value).
    const endT = S.total() - 0.5, e = grab(endT);
    const vals = new Set(); for (let y = 700; y < 760; y++) for (let x = 40; x < 100; x++) vals.add(px(e, x, y).join(','));
    return { same, mid, left, right, glitch: diff(g1, g2), drift: diff(d1, d2), endValues: vals.size, endAvg: avg(e, 40, 700, 100, 760) };
  });
  expect(m.same, 'the same time drew two different frames').toBe(true);
  // A third of a stop under: the 180 grey photo reads darker in the middle of the frame.
  expect(m.mid[1]).toBeLessThan(176);
  expect(m.mid[1]).toBeGreaterThan(120);
  // Mixed colour temperature: warm on one side, cool on the other.
  expect((m.left[0] - m.left[2]) - (m.right[0] - m.right[2])).toBeGreaterThan(6);
  expect(m.glitch, 'no reframe in the first 3 seconds').toBeGreaterThan(m.drift * 1.5);
  expect(m.endValues, 'the end card is one perfect flat colour').toBeGreaterThan(3);
  // ...but it is still the brand's colour.
  expect(Math.abs(m.endAvg[0] - 0x83)).toBeLessThan(16);
  expect(Math.abs(m.endAvg[1] - 0x26)).toBeLessThan(16);
});
