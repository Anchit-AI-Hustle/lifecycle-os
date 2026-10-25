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

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
const words = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();

/**
 * The scenes, in order, with their seconds. spec:
 *   { brand:{name}, hook, lines:[...], products:[{title, price_text, image}],
 *     cta, store, images:[...] }
 */
function storyScenes(spec) {
  const s = spec || {};
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
  out.push({ kind: 'hook', seconds: 3.5, headline: hook || words(products[0] && products[0].title) || words(s.brand && s.brand.name), sub: '', image: firstImg });
  products.forEach((p, i) => {
    out.push({ kind: 'product', seconds: 4, headline: words(p.title), price: words(p.price_text), sub: '', image: p.image || imgs[(i + 1) % Math.max(1, imgs.length)] || '' });
  });
  lines.slice(0, 2).forEach((l, i) => {
    out.push({ kind: 'line', seconds: 3.5, headline: l, sub: '', image: imgs[(i + 2) % Math.max(1, imgs.length)] || firstImg });
  });
  const bname = words(s.brandName || (s.brand && s.brand.name)).toLowerCase();
  const endLine = [words(s.endLine), hook].find((x) => x && x.toLowerCase() !== bname) || '';
  out.push({ kind: 'end', seconds: 4, headline: endLine, sub: words(s.store).replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''), cta: words(s.cta) || 'Shop now', image: '' });
  // Held to MAX_SECONDS: the middle gives way first, never the hook or the end card.
  let total = out.reduce((a, x) => a + x.seconds, 0);
  while (total > MAX_SECONDS && out.length > 3) {
    const drop = out.findIndex((x, i) => i > 0 && i < out.length - 1 && x.kind === 'line') >= 0
      ? out.findIndex((x, i) => i > 0 && i < out.length - 1 && x.kind === 'line')
      : out.length - 2;
    total -= out[drop].seconds;
    out.splice(drop, 1);
  }
  let t = 0;
  return out.map((x) => { const y = Object.assign({}, x, { start: +t.toFixed(2) }); t += x.seconds; return y; });
}

/** The shot list a person (or a video model) reproduces this from. */
function storyBrief(spec) {
  const scenes = storyScenes(spec);
  const total = scenes.reduce((a, x) => a + x.seconds, 0);
  return {
    format: 'story', aspect: '9:16', size: '1080x1920', duration_s: +total.toFixed(1), max_s: MAX_SECONDS,
    scenes: scenes.map((x) => ({ kind: x.kind, start_s: x.start, duration_s: x.seconds, text: x.headline, price: x.price || null, image: x.image || null, cta: x.cta || null })),
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
  const pal = Object.assign({ primary: '#333366', on_primary: '#ffffff', accent: '#ffffff', on_accent: '#111111', surface: '#ffffff', ink: '#222222' }, s.palette || {});
  const fonts = Object.assign({ head: 'system-ui, sans-serif', body: 'system-ui, sans-serif' }, s.fonts || {});
  const name = words(s.brandName || (s.brand && s.brand.name) || '');
  // JSON in a <script> block: every "<" is escaped so no line can close it.
  const data = JSON.stringify({ scenes, total, pal, fonts, name }).replace(/</g, '\\u003c');
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
<div class="bar"><button type="button" id="play" class="main">Pause</button><button type="button" id="restart">Restart</button><button type="button" id="save">Save as video</button></div>
<p class="note" id="note">${esc(String(total))} seconds · ${scenes.length} scenes</p>
</div>
<script>
(function(){
  var D = ${data};
  var cv = document.getElementById('v'), cx = cv.getContext('2d');
  var W = 1080, H = 1920, note = document.getElementById('note');
  var imgs = {}, blocked = [];
  D.scenes.forEach(function (sc) {
    if (!sc.image || imgs[sc.image]) return;
    var im = new Image(); im.crossOrigin = 'anonymous';
    im.onerror = function () {
      // No CORS from the photo's host: shown, but it cannot be recorded.
      var plain = new Image(); plain.onload = function () { imgs[sc.image] = plain; plain.__plain = true; }; plain.src = sc.image;
      if (blocked.indexOf(sc.image) < 0) blocked.push(sc.image);
    };
    im.onload = function () { imgs[sc.image] = im; };
    im.src = sc.image;
  });
  function wrap(text, maxW, font) {
    cx.font = font; var out = [], line = '';
    String(text || '').split(' ').forEach(function (w) { var t = line ? line + ' ' + w : w; if (cx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; });
    if (line) out.push(line); return out;
  }
  function cover(im, k) {
    var r = Math.max(W / im.width, H / im.height) * k, w = im.width * r, h = im.height * r;
    cx.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
  }
  function hexA(hex, a) { var h = String(hex).replace('#', ''); if (h.length === 3) h = h.replace(/(.)/g, '$1$1'); var n = parseInt(h, 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function scene(sc, p, alpha) {
    cx.globalAlpha = alpha;
    var im = sc.image && imgs[sc.image];
    if (sc.kind === 'end' || !im) { cx.fillStyle = D.pal.primary; cx.fillRect(0, 0, W, H); }
    else {
      cover(im, 1.04 + 0.1 * p);
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
  function now() { return paused ? pausedAt : ((performance.now() - t0) / 1000); }
  function loop() {
    var t = now();
    if (t >= D.total) { if (recording) { recording.stop(); recording = null; } t0 = performance.now(); t = 0; }
    frame(t); requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  var playBtn = document.getElementById('play');
  function toggle() { if (paused) { t0 = performance.now() - pausedAt * 1000; paused = false; playBtn.textContent = 'Pause'; } else { pausedAt = now(); paused = true; playBtn.textContent = 'Play'; } }
  playBtn.onclick = toggle; cv.onclick = toggle;
  document.getElementById('restart').onclick = function () { t0 = performance.now(); paused = false; playBtn.textContent = 'Pause'; };
  document.getElementById('save').onclick = function () {
    if (blocked.length) { note.textContent = 'This video cannot be saved here: ' + blocked.length + ' photo(s) come from a host that does not allow them to be recorded. Play it, or save the creative page instead.'; return; }
    if (!window.MediaRecorder || !cv.captureStream) { note.textContent = 'This browser cannot record video. Open the creative in Chrome, Edge, Firefox or Safari 14.1+.'; return; }
    var type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].filter(function (m) { return MediaRecorder.isTypeSupported(m); })[0] || '';
    var chunks = [], rec;
    try { rec = new MediaRecorder(cv.captureStream(30), type ? { mimeType: type, videoBitsPerSecond: 6000000 } : undefined); }
    catch (e) { note.textContent = 'Recording could not start: ' + (e && e.message || e); return; }
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      var ext = /mp4/.test(rec.mimeType || type) ? 'mp4' : 'webm';
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || type || 'video/webm' }));
      a.download = (D.name || 'story').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-story-' + Math.round(D.total) + 's.' + ext;
      document.body.appendChild(a); a.click(); a.remove();
      note.textContent = 'Saved: ' + Math.round(D.total) + ' seconds, ' + ext.toUpperCase() + '.';
    };
    t0 = performance.now(); paused = false; playBtn.textContent = 'Pause';
    note.textContent = 'Recording ' + Math.round(D.total) + ' seconds. Keep this tab open.';
    rec.start(250); recording = rec;
  };
})();
</script>
</body></html>`;
}

module.exports = { renderStoryAd, storyScenes, storyBrief, MAX_SECONDS };
