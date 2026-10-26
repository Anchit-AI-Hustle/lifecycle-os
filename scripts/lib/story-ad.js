'use strict';
/**
 * story-ad.js - the STORY video ad: a real, timed video up to 30 seconds.
 * ---------------------------------------------------------------------------
 * The operator, 2026-10-24: "ensure video ads are proper video ads upto 30 s;
 * current video ads are basically transitional ads - keep this variant too".
 * motion-ad.js stays the Transitional variant (two or three photos cross-fading
 * under the ad's lines, about ten seconds). This is the Story variant: a hook,
 * then each product of the send on its own photograph with its name and price,
 * then the ad's own lines, then the brand's end card - every scene timed, the
 * whole held to MAX_SECONDS.
 *
 * It is drawn on a <canvas> (1080 x 1920), not laid out in CSS, so the page can
 * SAVE IT AS A VIDEO FILE in the browser (MediaRecorder over the canvas stream:
 * MP4 where the browser records MP4, else WebM). A photograph whose host sends
 * no CORS header cannot be drawn into a recordable canvas; such a scene is
 * still shown, and saving says which photos block it instead of recording a
 * video without them.
 *
 * Nothing here writes copy: every line is one the ad, the slot or the store
 * already carries. Pure string building, no I/O.
 * ---------------------------------------------------------------------------
 */

const MAX_SECONDS = 30;
// The SHORT cut (2026-10-25): from how Pollo AI builds its product ads (read
// in independent walkthroughs; pollo.ai itself refuses automated reads): one
// opening, the product showcase, one closing impression, offered at 15 s
// beside longer cuts. Same facts, fewer scenes: never a line the long cut lacks.
const SHORT_SECONDS = 15;
// Each photographed shot has ONE literal camera move, never the same move
// twice in a row (Pollo's per-shot motion prompts: "slow push-in", a pan,
// "a light sweep across a packshot"). The words are the move's own brief.
const MOVES = [
  { id: 'push-in', say: 'slow push-in' },
  { id: 'pan-right', say: 'slow pan left to right' },
  { id: 'pull-out', say: 'slow pull-out' },
  { id: 'pan-left', say: 'slow pan right to left' },
  { id: 'rise', say: 'slow rise, bottom to top' },
];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
const words = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();

/**
 * The scenes, in order, with their seconds. spec:
 *   { brand:{name}, hook, lines:[...], products:[{title, price_text, image}],
 *     cta, store, images:[...] }
 */
function storyScenes(spec, opts) {
  const s = spec || {};
  const short = !!(opts && opts.cut === 'short');
  const out = [];
  const imgs = (Array.isArray(s.images) ? s.images : []).filter(Boolean);
  const products = (Array.isArray(s.products) ? s.products : []).filter((p) => p && words(p.title)).slice(0, 4);
  const lines = [];
  const seen = new Set();
  // A line that repeats a product's name says nothing its product scene did not.
  const named = products.map((p) => words(p.title).toLowerCase());
  const take = (t) => { const v = words(t); const k = v.toLowerCase(); if (v && v.length <= 110 && !seen.has(k) && !named.some((n) => n && k.includes(n))) { seen.add(k); lines.push(v); } };
  const hook = words(s.hook);
  if (hook) seen.add(hook.toLowerCase());
  (Array.isArray(s.lines) ? s.lines : []).forEach(take);
  const firstImg = (products[0] && products[0].image) || imgs[0] || '';
  out.push({ kind: 'hook', seconds: short ? 2.5 : 3.5, headline: hook || words(products[0] && products[0].title) || words(s.brand && s.brand.name), sub: '', image: firstImg });
  (short ? products.slice(0, 2) : products).forEach((p, i) => {
    out.push({ kind: 'product', seconds: 4, headline: words(p.title), price: words(p.price_text), sub: '', image: p.image || imgs[(i + 1) % Math.max(1, imgs.length)] || '' });
  });
  (short ? [] : lines.slice(0, 2)).forEach((l, i) => {
    out.push({ kind: 'line', seconds: 3.5, headline: l, sub: '', image: imgs[(i + 2) % Math.max(1, imgs.length)] || firstImg });
  });
  const bname = words(s.brandName || (s.brand && s.brand.name)).toLowerCase();
  const endLine = [words(s.endLine), hook].find((x) => x && x.toLowerCase() !== bname) || '';
  out.push({ kind: 'end', seconds: short ? 3.5 : 4, headline: endLine, sub: words(s.store).replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''), cta: words(s.cta) || 'Shop now', image: '' });
  // Held to MAX_SECONDS: the middle gives way first, never the hook or the end card.
  let total = out.reduce((a, x) => a + x.seconds, 0);
  const cap = short ? SHORT_SECONDS : MAX_SECONDS;
  while (total > cap && out.length > 3) {
    const drop = out.findIndex((x, i) => i > 0 && i < out.length - 1 && x.kind === 'line') >= 0
      ? out.findIndex((x, i) => i > 0 && i < out.length - 1 && x.kind === 'line')
      : out.length - 2;
    total -= out[drop].seconds;
    out.splice(drop, 1);
  }
  let t = 0;
  let m = 0;
  return out.map((x) => {
    // A move only where there is a photograph to move over; the end card is still.
    const move = x.image && x.kind !== 'end' ? MOVES[(m++) % MOVES.length] : null;
    const y = Object.assign({}, x, { start: +t.toFixed(2), move: move ? move.id : null, sweep: !!(x.image && x.kind === 'product') });
    t += x.seconds;
    return y;
  });
}

/** The shot list a person (or a video model) reproduces this from. */
function motionWords(x) {
  const mv = MOVES.find((m) => m.id === x.move);
  if (!mv) return null;
  return mv.say + ' on the photograph' + (x.sweep ? ', a soft light sweep across the product' : '') + ', no added text or props';
}
function briefScenes(scenes) {
  return scenes.map((x) => ({ kind: x.kind, start_s: x.start, duration_s: x.seconds, text: x.headline, price: x.price || null, image: x.image || null, cta: x.cta || null, motion: motionWords(x) }));
}
function storyBrief(spec) {
  const scenes = storyScenes(spec);
  const total = scenes.reduce((a, x) => a + x.seconds, 0);
  const shortScenes = storyScenes(spec, { cut: 'short' });
  const shortTotal = shortScenes.reduce((a, x) => a + x.seconds, 0);
  return {
    format: 'story', aspect: '9:16', size: '1080x1920', duration_s: +total.toFixed(1), max_s: MAX_SECONDS,
    structure: 'opening, product showcase, closing impression',
    scenes: briefScenes(scenes),
    cuts: { short: { duration_s: +shortTotal.toFixed(1), max_s: SHORT_SECONDS, scenes: briefScenes(shortScenes) } },
  };
}

/**
 * The self-contained player page. spec adds { palette:{primary,on_primary,
 * accent, on_accent, surface, ink}, fonts:{head, body}, brandName }.
 */
function renderStoryAd(spec) {
  const s = spec || {};
  const scenes = storyScenes(s);
  const total = +scenes.reduce((a, x) => a + x.seconds, 0).toFixed(2);
  const shortScenes = storyScenes(s, { cut: 'short' });
  const shortTotal = +shortScenes.reduce((a, x) => a + x.seconds, 0).toFixed(2);
  // A short cut identical to the full one is not a second version.
  const hasShort = shortTotal < total;
  const pal = Object.assign({ primary: '#333366', on_primary: '#ffffff', accent: '#ffffff', on_accent: '#111111', surface: '#ffffff', ink: '#222222' }, s.palette || {});
  const fonts = Object.assign({ head: 'system-ui, sans-serif', body: 'system-ui, sans-serif' }, s.fonts || {});
  const name = words(s.brandName || (s.brand && s.brand.name) || '');
  return storyPage({ cuts: { full: { scenes, total }, short: hasShort ? { scenes: shortScenes, total: shortTotal } : null }, pal, fonts, name });
}

/**
 * The player page for one story's data ({cuts, pal, fonts, name}). The code
 * renderer (api/_shared/code-video.js) rebuilds the page from the data it reads
 * back out of a saved page (storyDataFrom), so the script it runs is always this
 * one, never a page a request supplied.
 */
function storyPage(all) {
  const scenes = all.cuts.full.scenes, total = all.cuts.full.total;
  const hasShort = !!all.cuts.short;
  const shortTotal = hasShort ? all.cuts.short.total : total;
  const pal = all.pal, fonts = all.fonts, name = all.name;
  // JSON in a <script> block: every "<" is escaped so no line can close it.
  const data = JSON.stringify(all).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)} story video ad</title>
<style>
  html,body{margin:0;height:100%;background:${esc(pal.surface)};font-family:${esc(fonts.body)};color:${esc(pal.ink)}}
  .wrap{display:flex;flex-direction:column;align-items:center;gap:10px;padding:10px}
  canvas{width:min(100%,360px);aspect-ratio:9/16;height:auto;border-radius:12px;display:block;cursor:pointer;background:${esc(pal.primary)}}
  .bar{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
  button{font:600 13px/1 ${esc(fonts.body)};padding:10px 14px;min-height:40px;border-radius:999px;border:1px solid ${esc(pal.primary)};background:${esc(pal.surface)};color:${esc(pal.primary)};cursor:pointer}
  button.main{background:${esc(pal.primary)};color:${esc(pal.on_primary)}}
  .note{font-size:12px;max-width:360px;text-align:center;margin:0}
</style></head>
<body><div class="wrap">
<canvas id="v" width="1080" height="1920" aria-label="${esc(name)} story video ad, ${total} seconds"></canvas>
<div class="bar">${hasShort ? `<button type="button" id="cut" aria-pressed="false" data-cut="full">${esc(String(Math.round(shortTotal)))} s cut</button>` : ''}<button type="button" id="play" class="main">Pause</button><button type="button" id="restart">Restart</button><button type="button" id="save">Save as video</button></div>
<p class="note" id="note">${esc(String(total))} seconds · ${scenes.length} scenes</p>
</div>
<script>
(function(){
  var ALL = ${data};
  var D = { scenes: ALL.cuts.full.scenes, total: ALL.cuts.full.total, pal: ALL.pal, fonts: ALL.fonts, name: ALL.name };
  var cv = document.getElementById('v'), cx = cv.getContext('2d');
  var W = 1080, H = 1920, note = document.getElementById('note');
  var imgs = {}, blocked = [], imgsWanted = {};
  [].concat(ALL.cuts.full.scenes, ALL.cuts.short ? ALL.cuts.short.scenes : []).forEach(function (sc) {
    if (!sc.image || imgsWanted[sc.image]) return;
    imgsWanted[sc.image] = new Promise(function (done) {
      var im = new Image(); im.crossOrigin = 'anonymous';
      im.onerror = function () {
        // No CORS from the photo's host: shown, but it cannot be recorded.
        if (window.__STORY_RENDER) { if (blocked.indexOf(sc.image) < 0) blocked.push(sc.image); done(); return; }
        var plain = new Image(); plain.onload = function () { imgs[sc.image] = plain; plain.__plain = true; done(); }; plain.onerror = function () { done(); }; plain.src = sc.image;
        if (blocked.indexOf(sc.image) < 0) blocked.push(sc.image);
      };
      im.onload = function () { imgs[sc.image] = im; done(); };
      im.src = sc.image;
    });
  });
  function wrap(text, maxW, font) {
    cx.font = font; var out = [], line = '';
    String(text || '').split(' ').forEach(function (w) { var t = line ? line + ' ' + w : w; if (cx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; });
    if (line) out.push(line); return out;
  }
  // One camera move per shot (see MOVES): eased, slow, never more than ~8%.
  function cover(im, move, p) {
    var e = p * p * (3 - 2 * p), k = 1.06, dx = 0, dy = 0;
    if (move === 'push-in') k = 1.04 + 0.1 * e;
    else if (move === 'pull-out') k = 1.14 - 0.1 * e;
    else if (move === 'pan-right') { k = 1.12; dx = (e - 0.5) * -0.08 * W; }
    else if (move === 'pan-left') { k = 1.12; dx = (e - 0.5) * 0.08 * W; }
    else if (move === 'rise') { k = 1.12; dy = (e - 0.5) * 0.06 * H; }
    var r = Math.max(W / im.width, H / im.height) * k, w = im.width * r, h = im.height * r;
    cx.drawImage(im, (W - w) / 2 + dx, (H - h) / 2 + dy, w, h);
  }
  // A soft band of light crossing the product once, mid-shot.
  function sweep(p) {
    if (p < 0.2 || p > 0.75) return;
    var q = (p - 0.2) / 0.55, x = -W * 0.4 + q * W * 1.8;
    var g = cx.createLinearGradient(x - 220, 0, x + 220, H * 0.25);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = g; cx.fillRect(0, 0, W, H * 0.62);
  }
  function hexA(hex, a) { var h = String(hex).replace('#', ''); if (h.length === 3) h = h.replace(/(.)/g, '$1$1'); var n = parseInt(h, 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function scene(sc, p, alpha) {
    cx.globalAlpha = alpha;
    var im = sc.image && imgs[sc.image];
    if (sc.kind === 'end' || !im) { cx.fillStyle = D.pal.primary; cx.fillRect(0, 0, W, H); }
    else {
      cover(im, sc.move, p);
      if (sc.sweep) sweep(p);
      var g = cx.createLinearGradient(0, H * 0.45, 0, H);
      g.addColorStop(0, hexA(D.pal.ink, 0)); g.addColorStop(1, hexA(D.pal.ink, 0.72));
      cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    }
    var onImg = sc.kind !== 'end' && im;
    var fg = onImg ? '#ffffff' : D.pal.on_primary;
    var rise = Math.max(0, 1 - p * 4) * 40, tA = Math.min(1, p * 4) * alpha;
    cx.globalAlpha = tA; cx.fillStyle = fg; cx.textAlign = 'center';
    var big = sc.kind === 'end' ? 88 : (sc.kind === 'product' ? 72 : 84);
    var lines = wrap(sc.headline, W - 160, '700 ' + big + 'px ' + D.fonts.head);
    var y = sc.kind === 'end' ? H * 0.40 : H - 420 - (lines.length - 1) * big * 1.15;
    lines.forEach(function (l, i) { cx.fillText(l, W / 2, y + rise + i * big * 1.15); });
    y += lines.length * big * 1.15;
    if (sc.price) {
      cx.font = '700 64px ' + D.fonts.body; var pw = cx.measureText(sc.price).width + 80;
      cx.fillStyle = D.pal.accent; roundRect(W / 2 - pw / 2, y + 10 + rise, pw, 104, 52); cx.fill();
      cx.fillStyle = D.pal.on_accent; cx.fillText(sc.price, W / 2, y + 84 + rise);
    }
    if (sc.kind === 'end') {
      cx.font = '700 58px ' + D.fonts.body; var bw = cx.measureText(sc.cta).width + 140;
      cx.fillStyle = D.pal.surface; roundRect(W / 2 - bw / 2, y + 60, bw, 130, 65); cx.fill();
      cx.fillStyle = D.pal.primary; cx.fillText(sc.cta, W / 2, y + 145);
      if (sc.sub) { cx.fillStyle = fg; cx.font = '500 44px ' + D.fonts.body; cx.fillText(sc.sub, W / 2, y + 290); }
    }
    cx.globalAlpha = alpha; cx.textAlign = 'left'; cx.fillStyle = fg; cx.font = '700 44px ' + D.fonts.head;
    if (D.name && sc.kind !== 'end') cx.fillText(D.name, 64, 150);
    if (D.name && sc.kind === 'end') { cx.textAlign = 'center'; cx.font = '700 64px ' + D.fonts.head; cx.fillText(D.name, W / 2, H * 0.30); }
    cx.globalAlpha = 1;
  }
  function roundRect(x, y, w, h, r) { cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }
  function frame(t) {
    cx.clearRect(0, 0, W, H);
    var i = 0; while (i < D.scenes.length - 1 && t >= D.scenes[i + 1].start) i++;
    var sc = D.scenes[i], p = Math.min(1, (t - sc.start) / sc.seconds);
    scene(sc, p, 1);
    var nx = D.scenes[i + 1], left = sc.start + sc.seconds - t;
    if (nx && left < 0.45) scene(nx, 0, 1 - left / 0.45);
    // story progress: one segment per scene
    var gap = 10, segW = (W - 96 - gap * (D.scenes.length - 1)) / D.scenes.length;
    D.scenes.forEach(function (s2, k) {
      var f = k < i ? 1 : (k === i ? p : 0);
      cx.fillStyle = 'rgba(255,255,255,0.35)'; cx.fillRect(48 + k * (segW + gap), 60, segW, 8);
      cx.fillStyle = '#ffffff'; cx.fillRect(48 + k * (segW + gap), 60, segW * f, 8);
    });
  }
  var t0 = performance.now(), paused = false, pausedAt = 0, recording = null;
  // THE TRACK (2026-10-25): the brand's composed music, handed in by the page
  // that composed it (window.setTrack). It plays from the start of every pass,
  // pauses with the video, fades over the last 0.8 s, and is recorded into the
  // saved file beside the canvas.
  var track = null, actx = null, gain = null, dest = null;
  function trackFrom(sec) { if (!track) return; try { track.currentTime = sec || 0; if (!paused) { var pr = track.play(); if (pr && pr.catch) pr.catch(function () {}); } } catch (_) {} }
  function wireTrack() {
    if (actx || !track) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      actx = new AC(); var src = actx.createMediaElementSource(track); gain = actx.createGain();
      dest = actx.createMediaStreamDestination(); src.connect(gain); gain.connect(actx.destination); gain.connect(dest);
    } catch (_) { actx = null; }
  }
  window.setTrack = function (url, label) {
    if (track) { try { track.pause(); } catch (_) {} }
    track = null;
    if (!url) { note.textContent = 'Music removed.'; return; }
    track = new Audio(); track.src = url; track.preload = 'auto'; track.loop = false;
    if (actx) { try { actx.close(); } catch (_) {} actx = null; gain = null; dest = null; }
    wireTrack();
    t0 = performance.now(); paused = false; playBtn.textContent = 'Pause'; trackFrom(0);
    note.textContent = 'Music: ' + (label || 'the composed track') + '. It is saved into the video.';
    document.documentElement.setAttribute('data-track', 'on');
  };
  // The page that composed the track sends its bytes (a sandboxed frame cannot
  // read the parent's blob: address); an https address is taken as it is.
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || d.type !== 'lifecycle-story-track') return;
    if (d.blob && typeof Blob !== 'undefined' && d.blob instanceof Blob) window.setTrack(URL.createObjectURL(d.blob), d.label);
    else if (typeof d.url === 'string' && d.url.indexOf('https://') === 0) window.setTrack(d.url, d.label);
    else if (d.clear) window.setTrack('', '');
  });
  function now() { return paused ? pausedAt : ((performance.now() - t0) / 1000); }
  function loop() {
    var t = now();
    if (t >= D.total) { if (recording) { recording.stop(); recording = null; } t0 = performance.now(); t = 0; trackFrom(0); }
    if (track && gain && actx) { var left = D.total - t; gain.gain.value = left < 0.8 ? Math.max(0, left / 0.8) : 1; }
    frame(t); requestAnimationFrame(loop);
  }
  // THE CODE RENDERER (api/_shared/code-video.js) draws every frame at its own
  // time and encodes it; the live loop would draw over it, so it stays off.
  window.__story = {
    canvas: cv, frame: frame,
    // Draw straight at the size being encoded (the scene is laid out at 1080 x 1920).
    size: function (w, h) { cv.width = w; cv.height = h; cx.setTransform(w / W, 0, 0, h / H, 0, 0); },
    cut: function (c) { var x = c === 'short' && ALL.cuts.short ? ALL.cuts.short : ALL.cuts.full; D.scenes = x.scenes; D.total = x.total; return D.total; },
    total: function () { return D.total; },
    blocked: function () { return blocked.slice(); },
    ready: function () {
      var want = Object.keys(imgsWanted);
      return Promise.all(want.map(function (u) { return imgsWanted[u]; }));
    }
  };
  if (!window.__STORY_RENDER) requestAnimationFrame(loop);
  var playBtn = document.getElementById('play');
  function toggle() {
    if (paused) { t0 = performance.now() - pausedAt * 1000; paused = false; playBtn.textContent = 'Pause'; if (track) { if (actx && actx.state === 'suspended') actx.resume(); trackFrom(pausedAt); } }
    else { pausedAt = now(); paused = true; playBtn.textContent = 'Play'; if (track) { try { track.pause(); } catch (_) {} } }
  }
  playBtn.onclick = toggle; cv.onclick = toggle;
  var cutBtn = document.getElementById('cut');
  if (cutBtn) cutBtn.onclick = function () {
    var toShort = cutBtn.getAttribute('data-cut') === 'full', c = toShort ? ALL.cuts.short : ALL.cuts.full;
    D.scenes = c.scenes; D.total = c.total;
    cutBtn.setAttribute('data-cut', toShort ? 'short' : 'full'); cutBtn.setAttribute('aria-pressed', toShort ? 'true' : 'false');
    cutBtn.textContent = toShort ? Math.round(ALL.cuts.full.total) + ' s cut' : Math.round(ALL.cuts.short.total) + ' s cut';
    note.textContent = Math.round(c.total) + ' seconds · ' + c.scenes.length + ' scenes';
    t0 = performance.now(); paused = false; playBtn.textContent = 'Pause'; trackFrom(0);
  };
  document.getElementById('restart').onclick = function () { t0 = performance.now(); paused = false; playBtn.textContent = 'Pause'; trackFrom(0); };
  document.getElementById('save').onclick = function () {
    if (blocked.length) { note.textContent = 'This video cannot be saved here: ' + blocked.length + ' photo(s) come from a host that does not allow them to be recorded. Play it, or save the creative page instead.'; return; }
    if (!window.MediaRecorder || !cv.captureStream) { note.textContent = 'This browser cannot record video. Open the creative in Chrome, Edge, Firefox or Safari 14.1+.'; return; }
    var type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].filter(function (m) { return MediaRecorder.isTypeSupported(m); })[0] || '';
    var chunks = [], rec;
    var stream = cv.captureStream(30);
    if (track) { wireTrack(); if (actx && actx.state === 'suspended') actx.resume(); if (dest) dest.stream.getAudioTracks().forEach(function (a) { stream.addTrack(a); }); }
    try { rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6000000, audioBitsPerSecond: 192000 } : undefined); }
    catch (e) { note.textContent = 'Recording could not start: ' + (e && e.message || e); return; }
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      var ext = /mp4/.test(rec.mimeType || type) ? 'mp4' : 'webm';
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || type || 'video/webm' }));
      a.download = (D.name || 'story').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-story-' + Math.round(D.total) + 's.' + ext;
      document.body.appendChild(a); a.click(); a.remove();
      note.textContent = 'Saved: ' + Math.round(D.total) + ' seconds, ' + ext.toUpperCase() + (track ? ', with music' : '') + '.';
    };
    t0 = performance.now(); paused = false; playBtn.textContent = 'Pause'; trackFrom(0);
    note.textContent = 'Recording ' + Math.round(D.total) + ' seconds' + (track ? ' with music' : '') + '. Keep this tab open.';
    rec.start(250); recording = rec;
  };
})();
</script>
</body></html>`;
}

/**
 * The story's data, read back out of a page renderStoryAd made (the JSON after
 * `var ALL = `), validated field by field: only the fields the player reads, as
 * strings and numbers, images only as http(s) addresses. Null when it is not one.
 */
function storyDataFrom(html) {
  const m = String(html || '').match(/var ALL = (\{[\s\S]*?\});\n/);
  if (!m) return null;
  let raw;
  try { raw = JSON.parse(m[1]); } catch (_) { return null; }
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n || 300) : '');
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const KINDS = new Set(['hook', 'product', 'line', 'end']);
  const MOVE_IDS = new Set(MOVES.map((x) => x.id));
  const cut = (c) => {
    if (!c || !Array.isArray(c.scenes) || !c.scenes.length) return null;
    const scenes = c.scenes.slice(0, 12).map((x) => ({
      kind: KINDS.has(x && x.kind) ? x.kind : 'line',
      headline: str(x && x.headline, 200), price: str(x && x.price, 40) || undefined,
      sub: str(x && x.sub, 120) || undefined, cta: str(x && x.cta, 40) || undefined,
      image: /^https?:\/\/[^\s"'<>]+$/i.test(str(x && x.image, 2000)) ? str(x.image, 2000) : undefined,
      move: MOVE_IDS.has(x && x.move) ? x.move : undefined, sweep: !!(x && x.sweep),
      start: Math.max(0, num(x && x.start)), seconds: Math.min(MAX_SECONDS, Math.max(0.5, num(x && x.seconds))),
    }));
    const total = +scenes.reduce((a, x) => a + x.seconds, 0).toFixed(2);
    let t = 0; scenes.forEach((x) => { x.start = +t.toFixed(2); t += x.seconds; });
    return total <= MAX_SECONDS + 0.01 ? { scenes, total } : null;
  };
  const full = cut(raw && raw.cuts && raw.cuts.full);
  if (!full) return null;
  const hex = (v, d) => (/^#[0-9a-f]{3,8}$/i.test(String(v || '')) ? v : d);
  const fam = (v) => String(v || 'system-ui, sans-serif').replace(/[^\w\s,'"-]/g, '').slice(0, 160);
  const p = (raw && raw.pal) || {};
  return {
    cuts: { full, short: cut(raw.cuts.short) },
    pal: { primary: hex(p.primary, '#333366'), on_primary: hex(p.on_primary, '#ffffff'), accent: hex(p.accent, '#ffffff'), on_accent: hex(p.on_accent, '#111111'), surface: hex(p.surface, '#ffffff'), ink: hex(p.ink, '#222222') },
    fonts: { head: fam(raw.fonts && raw.fonts.head), body: fam(raw.fonts && raw.fonts.body) },
    name: str(raw.name, 80),
  };
}

module.exports = { renderStoryAd, storyPage, storyDataFrom, storyScenes, storyBrief, MAX_SECONDS, SHORT_SECONDS, MOVES };
