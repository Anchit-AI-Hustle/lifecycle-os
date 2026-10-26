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
 * (a Chromium without the H.264 encoder), said in `codec`/`container`. Silent:
 * the encoder offers no AAC, the audio ad platforms expect; a track composed
 * on /brain is still mixed in by the page's own "Save as video". 720 x 1280
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

function mediabunnySource() {
  // The package exports no path to its browser bundle, so it is read by file;
  // vercel.json includeFiles puts this exact file in the function.
  return fs.readFileSync(path.join(__dirname, '..', '..', 'node_modules', 'mediabunny', 'dist', 'bundles', 'mediabunny.min.cjs'), 'utf8');
}

/** The bitrate that keeps `seconds` of video under the response cap, at most `ceiling`. */
function bitrateFor(seconds, ceiling) {
  const budget = Math.floor((MAX_BYTES_OUT * 8 * 0.9) / Math.max(1, seconds));
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
  else return { ok: false, error: 'this browser has no video encoder (WebCodecs H.264 or VP9)' };
  const output = new M.Output({ format, target: new M.BufferTarget() });
  const source = new M.CanvasSource(S.canvas, { codec, bitrate: new M.Quality({ bitrate: o.bitrate }), keyFrameInterval: 2, latencyMode: o.latency || 'quality' });
  output.addVideoTrack(source, { frameRate: o.fps });
  await output.start();
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
  return { ok: true, codec, container, frames, seconds: total, bytes: bytes.length, b64: btoa(bin), blocked: S.blocked(), draw_ms: Math.round(drawMs), encode_ms: Math.round(encMs) };
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
  let bitrate = bitrateFor(seconds, width >= 1080 ? 4000000 : 2500000);
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
      const tPage = Date.now();
      // The size asked for first, then each smaller one, while time remains.
      const ladder = SIZE_ORDER.slice(SIZE_ORDER.indexOf(SIZE_ORDER.includes(o.size) ? o.size : '720p'));
      let r = null, tried = [];
      for (const sz of ladder) {
        const [w, h] = SIZES[sz];
        const left = deadline - Date.now();
        if (left < 8000) break;
        r = await pg.evaluate(encodeInPage, { cut, width: w, height: h, fps, bitrate: bitrateFor(seconds, w >= 1080 ? 4000000 : 2500000), latency: o.latency, budgetMs: left - 4000 });
        tried.push(sz + (r && r.slow ? ' (' + r.error + ')' : ''));
        if (r && r.ok) { width = w; height = h; bitrate = bitrateFor(seconds, w >= 1080 ? 4000000 : 2500000); break; }
        if (!(r && r.slow)) break;
      }
      if (!r || !r.ok) return { ok: false, error: r && r.slow ? 'too_slow' : 'encode_failed', tried, message: r && r.slow ? 'This server could not render the video in time (' + tried.join('; ') + '). Try the short cut, or save it from the Story player in your browser.' : 'The video could not be encoded: ' + ((r && r.error) || 'no answer from the page') + '.' };
      const buffer = Buffer.from(r.b64, 'base64');
      return {
        ok: true, buffer, mime: r.container === 'mp4' ? 'video/mp4' : 'video/webm',
        codec: r.codec === 'avc' ? 'H.264' : 'VP9', container: r.container, frames: r.frames, seconds: r.seconds,
        width, height, fps, bitrate, bytes: buffer.length, render_ms: Date.now() - t0, cut,
        images, audio: 'none (silent: this browser encodes no AAC)', browser: { source: info.source, version: info.version },
        timing: { launch_ms: info.launch_ms, page_ms: tPage - t0 - (info.launch_ms || 0), draw_ms: r.draw_ms, encode_ms: r.encode_ms }, tried,
      };
    }, { waitMs: 4000, prefer: o.prefer });
  } catch (e) {
    if (e && e.code === 'busy') return { ok: false, error: 'busy', message: 'Another video or site is being rendered on this server right now. Try again in a minute.' };
    if (e && e.code === 'no_browser') return { ok: false, error: 'no_browser', message: 'This server has no browser to render the video with.' };
    return { ok: false, error: 'render_failed', message: 'The video could not be rendered: ' + String((e && e.message) || e).slice(0, 200) };
  }
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
  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const r = await renderStoryVideo({ html: typeof b.html === 'string' ? b.html.slice(0, 400000) : '', data: b.data && typeof b.data === 'object' ? b.data : null, cut: b.cut, size: b.size, fps: b.fps });
  if (r.ok) res.setHeader('X-Video-Tried', (r.tried || []).join('; ').slice(0, 300));
  if (!r.ok) return res.status(r.error === 'not_a_story' ? 400 : (r.error === 'busy' ? 429 : 500)).json(r);
  if (r.bytes > MAX_BYTES_OUT) return res.status(413).json({ ok: false, error: 'too_large', message: 'The video came out at ' + (r.bytes / 1048576).toFixed(1) + ' MB, over what one answer can carry. Try the short cut or 540p.' });
  const data = require('../../scripts/lib/story-ad.js').storyDataFrom(typeof b.html === 'string' ? b.html : '  var ALL = ' + JSON.stringify(b.data || {}) + ';\n');
  res.setHeader('Content-Type', r.mime);
  res.setHeader('Content-Disposition', 'attachment; filename="' + fileName(r, data && data.name) + '"');
  res.setHeader('X-Video-Codec', r.codec);
  res.setHeader('X-Video-Container', r.container);
  res.setHeader('X-Video-Seconds', String(r.seconds));
  res.setHeader('X-Video-Frames', String(r.frames));
  res.setHeader('X-Video-Size', r.width + 'x' + r.height);
  res.setHeader('X-Video-Render-Ms', String(r.render_ms));
  res.setHeader('X-Video-Images-Refused', String(r.images.refused.length));
  return res.status(200).end(r.buffer);
}

module.exports = { renderStoryVideo, handle, bitrateFor, fetchImage, MAX_IMAGE_BYTES, MAX_IMAGES_TOTAL, fileName, SIZES, SIZE_ORDER, MAX_BYTES_OUT, ORIGIN, DEFAULT_BUDGET_MS };
