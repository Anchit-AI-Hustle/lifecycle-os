'use strict';
/**
 * code-video.js — a real video file made in CODE: no model, no API key, no ffmpeg.
 * ---------------------------------------------------------------------------
 * The operator, 2026-10-26: "Ensure videos are also created if no hugging face
 * key is also provided. Figure out how to generate the videos using code, do
 * proper competitive benchmarking and research on it, and then implement."
 * The benchmark is docs/code-video-benchmark.md. The short of it:
 *   - Remotion (React -> frames -> video) needs a paid company licence past 3
 *     people and its own compositor/ffmpeg; Revideo / Motion Canvas (MIT) and
 *     HeyGen's HyperFrames (Apache-2.0, HTML -> MP4) all hand frames to FFmpeg;
 *     editly needs ffmpeg + ffprobe on PATH. A Vercel function has no ffmpeg,
 *     and adding one costs ~70 MB of a 250 MB budget this function already
 *     spends ~116 MB of on Chromium.
 *   - Every one of them renders the same way underneath: a DETERMINISTIC frame
 *     at time t, stepped frame by frame (never a screen recording in real
 *     time). Our Story video already draws a pure frame(t) on a <canvas>.
 *   - The browser this function already ships (@sparticuz/chromium 153) has
 *     WebCodecs with an H.264 encoder (measured 2026-10-26: avc1.42001f /
 *     4d0028 / 640028 supported; AAC is not, Opus is). Mediabunny (MPL-2.0,
 *     the successor of mp4-muxer, sponsored by Remotion) muxes the encoded
 *     frames into an MP4 in the page. So: frame(t) -> VideoEncoder -> MP4,
 *     all inside the Chromium we already have. Hugging Face's keyless Spaces
 *     were ruled out: an unauthenticated caller shares a ~2-minute daily
 *     ZeroGPU pool, from one server address, for every visitor.
 *
 * WHAT IS RENDERED. The Story video (scripts/lib/story-ad.js): the page is
 * REBUILT from the story's validated data (storyDataFrom -> storyPage), so the
 * script that runs is always ours, never markup a request supplied. Its photos
 * are fetched by the server behind assertPublicUrl on every hop, images only,
 * capped, and handed to the page with CORS, so they are drawn (a browser could
 * not record a photo whose host sends no CORS header). Nothing else leaves:
 * every other request the page makes is refused, behind the launcher's dead proxy.
 *
 * OUTPUT. H.264 in MP4 where the encoder exists (production), else VP9 in WebM
 * (a Chromium without the H.264 encoder), said in `codec`/`container`.
 * SOUND (2026-10-26, the operator: "audio missing in the video assets ...
 * background music with human voiceovers"): a music bed (the track composed
 * on /brain, else the code-made one from music-synth.js, as long as the video)
 * and a voiceover of the ad's own words (story-voice.js), mixed in the page by
 * an OfflineAudioContext: the voice placed at its scene, the music ducked
 * under it, a little room tone, faded in and out. AAC in the MP4 (Chromium's
 * WebCodecs has no AAC encoder, so @mediabunny/aac-encoder, FFmpeg's AAC
 * encoder in WebAssembly, MPL-2.0), Opus in the WebM. 720 x 1280
 * by default (TikTok's minimum is 540 x 960), the bitrate chosen so the file
 * stays under the 4.5 MB a Vercel response may carry.
 *
 * NOT a function file (api/_shared/ -> outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const ORIGIN = 'https://render.invalid';
const MAX_BYTES_OUT = 4 * 1024 * 1024;       // a Vercel response caps at 4.5 MB
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Every photo of one render together (the page asks for them at once): a
// render never holds more than this in memory, whatever the hosts declare.
const MAX_IMAGES_TOTAL = 24 * 1024 * 1024;
const SIZES = { '1080p': [1080, 1920], '720p': [720, 1280], '540p': [540, 960] };
const SIZE_ORDER = ['1080p', '720p', '540p'];
// Inside the 120 s function, with room to send the answer. Measured on
// @sparticuz/chromium 153 (2026-10-26): ~75 ms a frame at 720p, ~49 at 540p.
const DEFAULT_BUDGET_MS = 95000;

function aacSource() {
  // FFmpeg's AAC-LC encoder built to WebAssembly (MPL-2.0); traced by vercel.json.
  return fs.readFileSync(path.join(__dirname, '..', '..', 'node_modules', '@mediabunny', 'aac-encoder', 'dist', 'bundles', 'mediabunny-aac-encoder.min.js'), 'utf8');
}

function mediabunnySource() {
  // The package exports no path to its browser bundle, so it is read by file;
  // vercel.json includeFiles puts this exact file in the function.
  return fs.readFileSync(path.join(__dirname, '..', '..', 'node_modules', 'mediabunny', 'dist', 'bundles', 'mediabunny.min.cjs'), 'utf8');
}

const AUDIO_BPS = 128000;

/** The video bitrate that keeps `seconds` (and its audio) under the response cap, at most `ceiling`. */
function bitrateFor(seconds, ceiling, audioBps) {
  const budget = Math.floor((MAX_BYTES_OUT * 8 * 0.9) / Math.max(1, seconds)) - (Number(audioBps) || 0);
  return Math.max(400000, Math.min(ceiling || 3000000, budget));
}

/** One image, fetched by the server: public hosts only, every hop checked, images only, capped. */
async function fetchImage(url, fetchImpl, assertUrl, budget) {
  const assertPublicUrl = assertUrl || require('./brand-workspace-core.js').assertPublicUrl;
  let at = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(at);
    const r = await fetchImpl(at, { redirect: 'manual', headers: { Accept: 'image/*' }, signal: AbortSignal.timeout(12000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { at = new URL(r.headers.get('location'), at).toString(); continue; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) throw new Error('not an image (' + (type || 'no type') + ')');
    const len = Number(r.headers.get('content-length') || 0);
    if (len > MAX_IMAGE_BYTES) throw new Error('image over ' + (MAX_IMAGE_BYTES >> 20) + ' MB');
    // Counted as it arrives and cut at the cap (Codex, #364): a host that
    // omits or understates Content-Length is never read whole into memory.
    const tooBig = () => new Error('image over ' + (MAX_IMAGE_BYTES >> 20) + ' MB');
    const shared = () => new Error('the photos of this story are over ' + (MAX_IMAGES_TOTAL >> 20) + ' MB together');
    if (budget && len > budget.left) throw shared();
    const parts = [];
    let got = 0;
    if (r.body && typeof r.body.getReader === 'function') {
      const reader = r.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.byteLength;
          if (budget) budget.left -= value.byteLength;
          if (got > MAX_IMAGE_BYTES) throw tooBig();
          if (budget && budget.left < 0) throw shared();
          parts.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
        }
      } catch (e) { try { await reader.cancel(); } catch (_) { /* gone */ } throw e; }
    } else {
      const b = Buffer.from(await r.arrayBuffer());
      got = b.length; if (budget) budget.left -= got;
      if (got > MAX_IMAGE_BYTES) throw tooBig();
      if (budget && budget.left < 0) throw shared();
      parts.push(b);
    }
    return { type, buf: Buffer.concat(parts, got) };
  }
  throw new Error('too many redirects');
}

/** The page script that steps every frame and encodes it (runs in the browser). */
async function encodeInPage(o) {
  /* global Mediabunny */
  const S = window.__story;
  if (!S) return { ok: false, error: 'the story page did not start' };
  await S.ready();
  const total = S.cut(o.cut);
  const M = Mediabunny;
  const W = o.width, H = o.height;
  S.size(W, H);
  let codec = null, format = null, container = null;
  if (await M.canEncodeVideo('avc', { width: W, height: H, bitrate: o.bitrate })) { codec = 'avc'; format = new M.Mp4OutputFormat({ fastStart: 'in-memory' }); container = 'mp4'; }
  else if (await M.canEncodeVideo('vp9', { width: W, height: H, bitrate: o.bitrate })) { codec = 'vp9'; format = new M.WebMOutputFormat(); container = 'webm'; }
  else return { ok: false, unsupported: true, error: 'no H.264 or VP9 encoder at ' + W + 'x' + H };
  const output = new M.Output({ format, target: new M.BufferTarget() });
  const source = new M.CanvasSource(S.canvas, { codec, bitrate: new M.Quality({ bitrate: o.bitrate }), keyFrameInterval: 2, latencyMode: o.latency || 'quality' });
  output.addVideoTrack(source, { frameRate: o.fps });
  // THE SOUND: mixed once, before the frames, by an OfflineAudioContext.
  let mix = null, audioSource = null, audioCodec = null, sound = null;
  if (o.audio && (o.audio.music || (o.audio.voice && o.audio.voice.length))) {
    mix = await mixAudio(total, o.audio);
    audioCodec = container === 'mp4' ? 'aac' : 'opus';
    if (!(await M.canEncodeAudio(audioCodec)) && audioCodec === 'aac' && window.MediabunnyAacEncoder) window.MediabunnyAacEncoder.registerAacEncoder();
    if (await M.canEncodeAudio(audioCodec)) {
      audioSource = new M.AudioBufferSource({ codec: audioCodec, bitrate: o.audioBps || 128000 });
      output.addAudioTrack(audioSource);
      sound = { codec: audioCodec, voice_placed: mix.placed, voice_dropped: mix.dropped, music: !!o.audio.music };
    } else sound = { codec: null, error: 'no ' + audioCodec + ' encoder in this browser' };
  }
  await output.start();
  if (audioSource) { await audioSource.add(mix.buffer); audioSource.close(); }
  const frames = Math.round(total * o.fps), dt = 1 / o.fps;
  let drawMs = 0, encMs = 0;
  const started = performance.now();
  for (let i = 0; i < frames; i++) {
    // After a second of video, project the whole render from the pace so far:
    // one that cannot finish inside the budget stops now, so a smaller size
    // can be tried, instead of the function being cut off with nothing.
    if (i === o.fps && o.budgetMs && (performance.now() - started) / i * frames > o.budgetMs) {
      try { source.close(); } catch (_) { /* closed */ }
      return { ok: false, slow: true, error: 'projected ' + Math.round((performance.now() - started) / i * frames / 1000) + ' s at ' + W + 'x' + H };
    }
    const t = i * dt;
    const a = performance.now();
    S.frame(Math.min(t, total - 0.0001));
    const b = performance.now();
    await source.add(t, dt);
    drawMs += b - a; encMs += performance.now() - b;
  }
  source.close();
  await output.finalize();
  const bytes = new Uint8Array(output.target.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { ok: true, codec, container, frames, seconds: total, bytes: bytes.length, b64: btoa(bin), blocked: S.blocked(), draw_ms: Math.round(drawMs), encode_ms: Math.round(encMs), sound };

  // The mix. Voice lines at their scenes (never on top of each other: a line
  // that would start before the last one finished waits for it); the music
  // under them at a bed level, ducked while someone speaks; a quiet room
  // tone so the silences sound like a room, not a void; faded in and out;
  // the whole mix brought to -1 dBFS.
  async function mixAudio(total, a) {
    const rate = 48000, len = Math.ceil(total * rate);
    const ctx = new OfflineAudioContext(2, len, rate);
    const dec = async (u) => ctx.decodeAudioData(await (await fetch(u)).arrayBuffer());
    const voices = [];
    for (const v of (a.voice || [])) { try { voices.push({ start: v.start, buf: await dec(v.url) }); } catch (_) { /* a clip the browser cannot decode */ } }
    let at = 0, placed = 0, dropped = 0;
    const spans = [];
    for (const v of voices) {
      const start = Math.max(v.start + 0.25, at + 0.12);
      if (start > total - 0.6) { dropped++; continue; }
      const src = ctx.createBufferSource(); src.buffer = v.buf;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 85;
      const vg = ctx.createGain(); vg.gain.value = 1;
      src.connect(hp).connect(vg).connect(ctx.destination); src.start(start);
      const end = Math.min(total, start + v.buf.duration);
      spans.push([start, end]); at = start + v.buf.duration; placed++;
    }
    if (a.music) {
      let mb = null; try { mb = await dec(a.music); } catch (_) { mb = null; }
      if (mb) {
        const src = ctx.createBufferSource(); src.buffer = mb; src.loop = mb.duration < total - 0.05;
        const g = ctx.createGain(), bed = spans.length ? 0.42 : 0.75, duck = 0.14;
        g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(bed, 0.4);
        let last = 0.4, lvl = bed;
        for (const [s, e] of spans) {
          const a1 = Math.max(last, s - 0.18), a2 = Math.max(a1 + 0.01, s), b1 = Math.max(a2, e), b2 = b1 + 0.35;
          g.gain.setValueAtTime(bed, a1); g.gain.linearRampToValueAtTime(duck, a2); last = a2; lvl = duck;
          if (b2 > total - 0.9) break;
          g.gain.setValueAtTime(duck, b1); g.gain.linearRampToValueAtTime(bed, b2); last = b2; lvl = bed;
        }
        g.gain.setValueAtTime(lvl, Math.max(last, total - 0.9)); g.gain.linearRampToValueAtTime(0, total);
        src.connect(g).connect(ctx.destination); src.start(0);
      }
    }
    // Room tone: soft filtered noise, about -50 dB.
    const room = ctx.createBuffer(1, Math.min(len, rate * 2), rate), rd = room.getChannelData(0);
    let seed = 99;
    for (let i = 0; i < rd.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; rd[i] = (seed / 4294967296) * 2 - 1; }
    const rs = ctx.createBufferSource(); rs.buffer = room; rs.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    const rg = ctx.createGain(); rg.gain.value = 0.006;
    rs.connect(lp).connect(rg).connect(ctx.destination); rs.start(0);
    const buffer = await ctx.startRendering();
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < d.length; i++) { const x = Math.abs(d[i]); if (x > peak) peak = x; } }
    if (peak > 0) { const k = 0.89 / peak; for (let c = 0; c < buffer.numberOfChannels; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; } }
    return { buffer, placed, dropped };
  }
}

/**
 * Render one story to a video file.
 *   data:   the story's data (story-ad.storyDataFrom), or
 *   html:   a page story-ad made (the data is read back out of it)
 *   cut:    'full' | 'short'      size: '720p' | '540p' | '1080p'   fps: 24 | 30
 * Resolves { ok, buffer, mime, codec, container, frames, seconds, width, height,
 * bitrate, render_ms, images:{used, refused:[{url, why}]}, browser } or
 * { ok:false, error, message }.
 */
async function renderStoryVideo(opts) {
  const o = opts || {};
  const story = require('../../scripts/lib/story-ad.js');
  const data = o.data ? story.storyDataFrom('  var ALL = ' + JSON.stringify(o.data) + ';\n') : story.storyDataFrom(o.html);
  if (!data) return { ok: false, error: 'not_a_story', message: 'That is not a story video this app made, so there is nothing to render.' };
  const cut = o.cut === 'short' && data.cuts.short ? 'short' : 'full';
  const seconds = data.cuts[cut].total;
  let [width, height] = SIZES[o.size] || SIZES['720p'];
  // 24 frames a second by default: the film rate, and a fifth fewer frames to encode.
  const fps = Number(o.fps) === 30 ? 30 : 24;
  const sound = o.audio && ((o.audio.music && o.audio.music.bytes) || (o.audio.voice && o.audio.voice.length)) ? o.audio : null;
  const abps = sound ? AUDIO_BPS : 0;
  let bitrate = bitrateFor(seconds, width >= 1080 ? 4000000 : 2500000, abps);
  // The sound's files, served to the page from this process (never fetched).
  const assets = new Map();
  if (sound && sound.music && sound.music.bytes) assets.set(ORIGIN + '/a/music', sound.music);
  (sound && sound.voice || []).forEach((v, i) => assets.set(ORIGIN + '/a/v' + i, { bytes: v.audio, mime: v.mime }));
  const audioArg = sound ? {
    music: sound.music && sound.music.bytes ? '/a/music' : null,
    voice: (sound.voice || []).map((v, i) => ({ start: v.start, url: '/a/v' + i })),
  } : null;
  const deadline = Date.now() + (Number(o.budgetMs) > 0 ? Number(o.budgetMs) : DEFAULT_BUDGET_MS);
  const fetchImpl = o.fetchImpl || fetch;
  const page = story.storyPage(data);
  const wanted = new Set([].concat(data.cuts.full.scenes, data.cuts.short ? data.cuts.short.scenes : []).map((x) => x.image).filter(Boolean));
  const images = { used: 0, refused: [] };
  const mb = mediabunnySource();
  const t0 = Date.now();
  const rb = require('./render-browser.js');
  try {
    return await rb.withBrowser(async (browser, info) => {
      const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, serviceWorkers: 'block', acceptDownloads: false });
      await ctx.addInitScript(() => { window.__STORY_RENDER = true; });
      const pg = await ctx.newPage();
      const imageBudget = { left: MAX_IMAGES_TOTAL };
      await pg.route('**/*', async (route) => {
        const req = route.request();
        const url = req.url();
        if (req.method() !== 'GET') return route.abort();
        if (url === ORIGIN + '/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: page });
        if (url === ORIGIN + '/mediabunny.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: mb });
        if (url === ORIGIN + '/aac.js' && sound) return route.fulfill({ status: 200, contentType: 'text/javascript', body: aacSource() });
        if (assets.has(url)) { const a = assets.get(url); return route.fulfill({ status: 200, contentType: a.mime || 'application/octet-stream', body: Buffer.from(a.bytes) }); }
        if (!wanted.has(url)) return route.abort();
        try {
          const img = await fetchImage(url, fetchImpl, o.assertUrl, imageBudget);
          images.used += 1;
          return route.fulfill({ status: 200, contentType: img.type, body: img.buf, headers: { 'Access-Control-Allow-Origin': '*' } });
        } catch (e) {
          images.refused.push({ url, why: String((e && e.message) || e).slice(0, 160) });
          return route.abort();
        }
      });
      await pg.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 30000 });
      await pg.addScriptTag({ url: ORIGIN + '/mediabunny.js' });
      if (sound) await pg.addScriptTag({ url: ORIGIN + '/aac.js' });
      const tPage = Date.now();
      // The size asked for first, then each smaller one, while time remains.
      const ladder = SIZE_ORDER.slice(SIZE_ORDER.indexOf(SIZE_ORDER.includes(o.size) ? o.size : '720p'));
      let r = null, tried = [], anySlow = false;
      for (const sz of ladder) {
        const [w, h] = SIZES[sz];
        const left = deadline - Date.now();
        // No time left to try this size: that is running out of time, said as such.
        if (left < 8000) { tried.push(sz + ' (no time left to start it)'); anySlow = true; break; }
        try {
          r = await pg.evaluate(encodeInPage, { cut, width: w, height: h, fps, bitrate: bitrateFor(seconds, w >= 1080 ? 4000000 : 2500000, abps), audio: audioArg, audioBps: AUDIO_BPS, latency: o.latency, budgetMs: left - 4000 });
        } catch (e) {
          // An encoder that fails part-way (it can at one size and not another).
          r = { ok: false, failed: true, error: String((e && e.message) || e).split('\n')[0].slice(0, 160) };
        }
        tried.push(sz + (r && !r.ok ? ' (' + r.error + ')' : ''));
        if (r && r.ok) { width = w; height = h; bitrate = bitrateFor(seconds, w >= 1080 ? 4000000 : 2500000, abps); break; }
        if (r && r.slow) anySlow = true;
        if (!nextRung(r)) break;
      }
      if (!r || !r.ok) return { ok: false, error: anySlow ? 'too_slow' : 'encode_failed', tried, message: anySlow ? 'This server could not render the video in time (' + tried.join('; ') + '). Try the short cut, or save it from the Story player in your browser.' : 'The video could not be encoded: ' + ((r && r.error) || 'no answer from the page') + '.' };
      const buffer = Buffer.from(r.b64, 'base64');
      return {
        ok: true, buffer, mime: r.container === 'mp4' ? 'video/mp4' : 'video/webm',
        codec: r.codec === 'avc' ? 'H.264' : 'VP9', container: r.container, frames: r.frames, seconds: r.seconds,
        width, height, fps, bitrate, bytes: buffer.length, render_ms: Date.now() - t0, cut,
        images, audio: audioSummary(r.sound, o.audio), browser: { source: info.source, version: info.version },
        timing: { launch_ms: info.launch_ms, page_ms: tPage - t0 - (info.launch_ms || 0), draw_ms: r.draw_ms, encode_ms: r.encode_ms }, tried,
      };
    }, { waitMs: 4000, prefer: o.prefer });
  } catch (e) {
    if (e && e.code === 'busy') return { ok: false, error: 'busy', message: 'Another video or site is being rendered on this server right now. Try again in a minute.' };
    if (e && e.code === 'no_browser') return { ok: false, error: 'no_browser', message: 'This server has no browser to render the video with.' };
    return { ok: false, error: 'render_failed', message: 'The video could not be rendered: ' + String((e && e.message) || e).slice(0, 200) };
  }
}

/**
 * The sound for one render: { music, voice, voiceLabel, voice_provider,
 * voice_own, voice_refusals, chars }.
 *   music: the track the caller composed ({ bytes, mime }), else the
 *          code-made one (music-synth.js) as long as the video, from the
 *          brief the caller sends (the slot's own music brief) or the brand's
 *          name, a new take each render unless one is named.
 *   voice: the ad's own words (story-voice.linesFor), spoken by the
 *          workspace's own ElevenLabs, then its own Gemini; the platform's
 *          keys only when `platform` is allowed, and `meter(chars)` agrees.
 */
async function soundFor(data, cut, o = {}) {
  const SV = require('./story-voice.js');
  const c = cut === 'short' && data.cuts.short ? data.cuts.short : data.cuts.full;
  const out = { music: null, voice: [], voiceLabel: '', voice_provider: null, voice_own: false, voice_refusals: [], chars: 0 };
  if (o.music && o.music.bytes && o.music.bytes.length) out.music = { bytes: o.music.bytes, mime: o.music.mime || 'audio/mpeg', label: 'your composed track' };
  else if (o.musicOff !== true) {
    const SY = require('../../music-synth.js');
    const brief = String(o.musicPrompt || '').slice(0, 4000) || ('An original warm, upbeat modern pop bed for ' + (data.name || 'the brand') + ', confident and friendly.');
    const m = SY.renderBytes(brief, Math.ceil(c.total), { take: String(o.take || Date.now().toString(36)).slice(0, 64) });
    out.music = { bytes: Buffer.from(m.bytes), mime: 'audio/wav', label: 'code-made music (' + m.plan.style + ')' };
  }
  if (o.voiceOff === true) return out;
  const lines = SV.linesFor(data, cut);
  if (!lines.length) { out.voice_refusals.push('The story has no words to speak.'); return out; }
  const own = [];
  const k = o.ownKeys || {};
  if (k.elevenlabs) own.push({ src: 'own', kind: 'elevenlabs', key: k.elevenlabs });
  if (k.gemini) own.push({ src: 'own', kind: 'gemini', auth: k.gemini });
  let v = own.length ? await SV.voiceTrack(lines, own, { fetchImpl: o.fetchImpl, deadline: o.deadline }) : { ok: false, refusals: [] };
  out.voice_refusals.push(...v.refusals);
  if (!v.ok) {
    const plat = [];
    const clean = (x) => String(x || '').replace(/[﻿​\s]/g, '');
    const ek = clean(process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY || process.env.XI_API_KEY), gk = clean(process.env.GEMINI_API_KEY);
    if (ek) plat.push({ src: 'platform', kind: 'elevenlabs', key: ek });
    if (gk) plat.push({ src: 'platform', kind: 'gemini', auth: { apiKey: gk } });
    if (plat.length && !o.platform) out.voice_refusals.push('The platform\'s voice is for a signed-in account: sign in to add a voiceover, or connect your own ElevenLabs or Gemini key.');
    else if (plat.length) {
      const chars = lines.reduce((n, l) => n + l.text.length, 0);
      const m = o.meter ? await o.meter(chars) : { ok: true, settle: async () => {}, release: async () => {} };
      if (!m || !m.ok) out.voice_refusals.push((m && m.message) || 'The voiceover could not be charged, so it was not made.');
      else {
        v = await SV.voiceTrack(lines, plat, { fetchImpl: o.fetchImpl, deadline: o.deadline });
        out.voice_refusals.push(...v.refusals);
        if (v.ok) { try { await m.settle(); } catch (_) { /* receipt only */ } } else { try { await m.release('no voice'); } catch (_) { /* nothing held */ } }
      }
    }
  }
  if (v.ok) {
    out.voice = v.clips; out.voice_provider = v.provider; out.voice_own = v.own; out.chars = v.chars;
    out.voiceLabel = 'voiceover by ' + (v.provider === 'elevenlabs' ? 'ElevenLabs' : 'Gemini TTS') + (v.own ? ' (your key)' : '');
  } else if (!out.voice_refusals.length) {
    out.voice_refusals.push('No voice model is connected: connect your own ElevenLabs or Gemini key on Connections / AI Models for a voiceover.');
  }
  return out;
}

/** What is heard in the file, in words. */
function audioSummary(sound, req) {
  if (!sound) return { codec: null, music: null, voice: null, words: 'silent' };
  if (!sound.codec) return { codec: null, music: null, voice: null, words: 'silent (' + sound.error + ')' };
  const music = sound.music ? ((req && req.music && req.music.label) || 'music') : null;
  const voice = sound.voice_placed ? ((req && req.voiceLabel) || 'voiceover') : null;
  const parts = [music, voice && (voice + (sound.voice_dropped ? ' (' + sound.voice_dropped + ' line(s) did not fit)' : ''))].filter(Boolean);
  return { codec: sound.codec === 'aac' ? 'AAC' : 'Opus', music, voice, voice_lines: sound.voice_placed || 0, words: parts.join(' + ') || 'silent' };
}

/**
 * Whether a size that did not render is worth trying one size smaller: it was
 * too slow, the browser has no encoder at that size, or the encoder failed
 * part-way. A story the page could not start is not (no size fixes it).
 */
function nextRung(r) {
  return !!(r && !r.ok && (r.slow || r.unsupported || r.failed));
}

/** The file name a download carries. */
function fileName(r, name) {
  return String(name || 'story').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) + '-story-' + Math.round(r.seconds) + 's.' + r.container;
}

/**
 * POST ?action=video-render on /api/public-config (the function that ships the
 * browser). Body: { html } (a story page this app made) or { data }, plus cut,
 * size, fps. Answers the video's bytes, or a JSON refusal with a sentence.
 * Who may ask: a signed-in account, or (as the open rendered read) a page of
 * THIS deployment; both under a per-address and per-instance limit, because a
 * render spends this server's CPU, never a provider's money.
 */
async function handle(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.removeHeader && res.removeHeader('Access-Control-Allow-Origin');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'post_only', message: 'Send the story to render as a POST.' });
  const core = require('./brand-workspace-core.js');
  let signedIn = false;
  try { const a = await core.requireUser(req); signedIn = !!(a && a.ok); } catch (_) { signedIn = false; }
  if (!signedIn && !core.samePageRequest(req)) {
    return res.status(403).json({ ok: false, error: 'not_this_site', message: 'Videos are rendered for this app\'s own pages. Open the ad in the app and press Make MP4 there.' });
  }
  const limited = require('./brand-render.js').rateCheck(req, Date.now(), 'video');
  if (limited) return res.status(429).json({ ok: false, error: 'rate_limited', message: limited });
  const tStart = Date.now();
  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const html = typeof b.html === 'string' ? b.html.slice(0, 400000) : '';
  const story = require('../../scripts/lib/story-ad.js');
  const sdata = b.data && typeof b.data === 'object' ? story.storyDataFrom('  var ALL = ' + JSON.stringify(b.data) + ';\n') : story.storyDataFrom(html);
  if (!sdata) return res.status(400).json({ ok: false, error: 'not_a_story', message: 'That is not a story video this app made, so there is nothing to render.' });
  const cutAsked = b.cut === 'short' && sdata.cuts.short ? 'short' : 'full';
  // The sound: music (the caller's composed track, else code-made) and the
  // voiceover (own keys; the platform's only for a signed-in account, metered).
  let audio = null, sound = null;
  if (b.audio !== false) {
    let music = null;
    if (typeof b.music_b64 === 'string' && b.music_b64.length <= 3500000 && /^audio\/(mpeg|mp3|wav|x-wav|wave|ogg|webm|mp4|aac|x-m4a)$/i.test(String(b.music_mime || ''))) {
      const bytes = Buffer.from(b.music_b64, 'base64');
      if (bytes.length > 1000) music = { bytes, mime: String(b.music_mime).toLowerCase() };
    }
    const ownKeys = {};
    try {
      const wc = require('./workspace-connections-core.js');
      const m = await wc.mediaKeysForCurrentRequest();
      if (m && m.elevenlabs && m.elevenlabs.api_key) ownKeys.elevenlabs = String(m.elevenlabs.api_key);
      const ov = await wc.llmOverridesForCurrentRequest();
      const kk = ov && ov.keys;
      if (kk && kk.gemini) ownKeys.gemini = { apiKey: String(kk.gemini) };
      else if (kk && kk.gemini_oauth && kk.gemini_oauth.access_token) ownKeys.gemini = { bearer: kk.gemini_oauth.access_token, project: kk.gemini_oauth.project || '' };
    } catch (_) { /* no workspace: no own keys */ }
    sound = await soundFor(sdata, cutAsked, {
      music, musicPrompt: typeof b.music_prompt === 'string' ? b.music_prompt : '', take: typeof b.take === 'string' ? b.take : '',
      voiceOff: b.voice === false, ownKeys, platform: signedIn, deadline: Date.now() + 25000,
      meter: async (chars) => {
        try {
          const m = await require('./credits-core.js').meter(req, 'audio.tts', { units: Math.max(1, Math.ceil(chars / 1000)), meta: { channel: 'video-render' } });
          if (!m.ok) return { ok: false, message: m.message || 'There are not enough credits for the voiceover.' };
          return m;
        } catch (e) { return { ok: false, message: 'The voiceover could not be charged: ' + String((e && e.message) || e).slice(0, 120) }; }
      },
    });
    audio = { music: sound.music, voice: sound.voice, voiceLabel: sound.voiceLabel };
  }
  // One function call is 120 s: the render gets what the sound left of 100 s.
  const r = await renderStoryVideo({ data: sdata, cut: b.cut, size: b.size, fps: b.fps, audio, budgetMs: Math.max(20000, Math.min(DEFAULT_BUDGET_MS, 100000 - (Date.now() - tStart))) });
  if (r.ok) res.setHeader('X-Video-Tried', (r.tried || []).join('; ').slice(0, 300));
  if (!r.ok) return res.status(r.error === 'not_a_story' ? 400 : (r.error === 'busy' ? 429 : 500)).json(r);
  if (r.bytes > MAX_BYTES_OUT) return res.status(413).json({ ok: false, error: 'too_large', message: 'The video came out at ' + (r.bytes / 1048576).toFixed(1) + ' MB, over what one answer can carry. Try the short cut or 540p.' });
  res.setHeader('Content-Type', r.mime);
  res.setHeader('Content-Disposition', 'attachment; filename="' + fileName(r, sdata.name) + '"');
  res.setHeader('X-Video-Audio', encodeURIComponent(String(r.audio.words || 'silent')).slice(0, 300));
  if (r.audio.codec) res.setHeader('X-Video-Audio-Codec', r.audio.codec);
  if (sound && sound.voice_refusals.length) res.setHeader('X-Video-Voice-Note', encodeURIComponent(sound.voice_refusals.join(' ')).slice(0, 1500));
  res.setHeader('Access-Control-Expose-Headers', 'X-Video-Codec, X-Video-Container, X-Video-Seconds, X-Video-Frames, X-Video-Size, X-Video-Render-Ms, X-Video-Images-Refused, X-Video-Tried, X-Video-Audio, X-Video-Audio-Codec, X-Video-Voice-Note');
  res.setHeader('X-Video-Codec', r.codec);
  res.setHeader('X-Video-Container', r.container);
  res.setHeader('X-Video-Seconds', String(r.seconds));
  res.setHeader('X-Video-Frames', String(r.frames));
  res.setHeader('X-Video-Size', r.width + 'x' + r.height);
  res.setHeader('X-Video-Render-Ms', String(r.render_ms));
  res.setHeader('X-Video-Images-Refused', String(r.images.refused.length));
  return res.status(200).end(r.buffer);
}

module.exports = { renderStoryVideo, handle, bitrateFor, nextRung, audioSummary, soundFor, AUDIO_BPS, fetchImage, MAX_IMAGE_BYTES, MAX_IMAGES_TOTAL, fileName, SIZES, SIZE_ORDER, MAX_BYTES_OUT, ORIGIN, DEFAULT_BUDGET_MS };
