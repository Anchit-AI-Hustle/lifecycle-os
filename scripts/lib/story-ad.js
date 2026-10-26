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

// THE LOOK (2026-10-26, the operator: "complete different templates, themes
// everything"). Every story used to be the same lower-third over the same
// full-frame photo for every brand. A look is two ids from asset-themes.js:
// the THEME (type case, weight and tracking, the price chip, the button, the
// progress bar, the cut between scenes, where the brand's name sits) and the
// TEMPLATE (where the photograph and the words are on the frame). Colours stay
// the brand's palette. Only allow-listed ids travel in the page's data, and the
// page draws them from the table below, never from a request.
const THEME_TABLE = (() => {
  let T = {};
  try { T = require('../../api/_shared/asset-themes.js').THEMES; } catch (_) { T = {}; }
  const out = {};
  for (const [id, t] of Object.entries(T)) {
    out[id] = { case: t.heading.case, weight: t.heading.weight, tracking: t.heading.tracking, scale: t.heading.scale, italic: !!t.heading.italic, price: t.price, button: t.button, radius: t.radius.image, align: t.align };
  }
  return out;
})();
const VIDEO_TEMPLATES = ['lower', 'title', 'split', 'editorial', 'frame'];
// How each theme moves between scenes, marks progress and places the name.
const THEME_MOTION = {
  editorial: { cut: 'fade', progress: 'line', name: 'tl' },
  bold: { cut: 'wipe', progress: 'segments', name: 'tl' },
  soft: { cut: 'fade', progress: 'dots', name: 'tc' },
  minimal: { cut: 'cut', progress: 'line', name: 'tl' },
  luxe: { cut: 'fade', progress: 'line', name: 'tc' },
  poster: { cut: 'slide', progress: 'dots', name: 'tc' },
  playful: { cut: 'slide', progress: 'dots', name: 'tc' },
  magazine: { cut: 'wipe', progress: 'segments', name: 'tl' },
};
/** A look the page can draw: known ids only, else the default (lower third, no theme). */
function cleanLook(l) {
  const x = l || {};
  const theme = typeof x.theme === 'string' && THEME_TABLE[x.theme] ? x.theme : (x.theme && THEME_TABLE[x.theme.id] ? x.theme.id : '');
  const template = VIDEO_TEMPLATES.includes(x.template) ? x.template : 'lower';
  return { theme, template };
}

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
const TEMPLATE_WORDS = {
  lower: 'full-frame photograph, the words in the lower third over a soft shade',
  title: 'the photograph framed inset on the brand colour, a title card under it',
  split: 'the photograph on the top half, the words on a brand-colour panel below',
  editorial: 'full-frame photograph, the words set top-left under a thin rule like a magazine page',
  frame: 'the photograph in an offset frame on the brand colour, the brand name on a strip beneath',
};
function lookWords(l) {
  const t = l && l.theme && THEME_TABLE[l.theme];
  return TEMPLATE_WORDS[(l && l.template) || 'lower'] + (t ? `; type ${t.case === 'upper' ? 'in capitals' : 'in sentence case'}, weight ${t.weight}` : '');
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
    look: (() => { const l = cleanLook(spec && spec.look); return { template: l.template, theme: l.theme || null, words: lookWords(l) }; })(),
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
  return storyPage({ cuts: { full: { scenes, total }, short: hasShort ? { scenes: shortScenes, total: shortTotal } : null }, pal, fonts, name, look: cleanLook(s.look) });
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
  all = Object.assign({}, all, { look: cleanLook(all.look) });
  const lookT = all.look.theme ? THEME_TABLE[all.look.theme] : null;
  const lookM = (all.look.theme && THEME_MOTION[all.look.theme]) || { cut: 'fade', progress: 'segments', name: 'tl' };
  const lookJson = JSON.stringify({ t: lookT, m: lookM, template: all.look.template }).replace(/</g, '\\u003c');
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
<canvas id="v" width="1080" height="1920" data-template="${esc(all.look.template)}" data-theme="${esc(all.look.theme || 'none')}" aria-label="${esc(name)} story video ad, ${total} seconds"></canvas>
<div class="bar">${hasShort ? `<button type="button" id="cut" aria-pressed="false" data-cut="full">${esc(String(Math.round(shortTotal)))} s cut</button>` : ''}<button type="button" id="play" class="main">Pause</button><button type="button" id="restart">Restart</button><button type="button" id="save">Save as video</button></div>
<p class="note" id="note">${esc(String(total))} seconds · ${scenes.length} scenes</p>
</div>
<script>
(function(){
  var ALL = ${data};
  var LOOK = ${lookJson};
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
  // THE HUMAN TOUCH (2026-10-26, the operator with the "Kill the AI Tell" card:
  // "ensure complete human touch"). A perfectly smooth, perfectly lit frame
  // is the tell before second 3. So the PHOTO (never the brand's text or
  // buttons) is held like a phone: a slow handheld drift, one half-step
  // reframe inside the first 3 seconds (a micro-glitch), and phone-camera light:
  // a third of a stop under, warm on one side and cool on the other, a soft
  // window spill; light grain over the whole frame. All of it is a function of
  // time, so every render of the same story is the same video.
  var curT = 0;
  function handheld(t) {
    var x = Math.sin(t * 1.3) * 3.2 + Math.sin(t * 2.9 + 1.7) * 1.6 + Math.sin(t * 7.1 + 0.4) * 0.5;
    var y = Math.sin(t * 1.1 + 2.1) * 2.6 + Math.sin(t * 3.3 + 0.9) * 1.3 + Math.sin(t * 6.7 + 2.6) * 0.4;
    // The half-step reframe: at 1.4 s the hand adjusts the phone, overshoots a
    // little and settles over a quarter second.
    var g = t - 1.4;
    if (g > 0 && g < 0.6) { var k = g < 0.12 ? g / 0.12 : Math.max(0, 1 - (g - 0.12) / 0.48); x += 9 * k; y -= 5 * k; }
    return { x: x, y: y, r: Math.sin(t * 0.9 + 0.3) * 0.0016 };
  }
  function phoneLight(side) {
    cx.fillStyle = 'rgba(0,0,0,0.12)'; cx.fillRect(0, 0, W, H);
    var m = cx.createLinearGradient(0, 0, W, 0);
    m.addColorStop(side ? 1 : 0, 'rgba(255,170,90,0.09)'); m.addColorStop(0.5, 'rgba(255,255,255,0)'); m.addColorStop(side ? 0 : 1, 'rgba(110,160,255,0.08)');
    cx.fillStyle = m; cx.fillRect(0, 0, W, H);
    var sx = side ? W * 0.9 : W * 0.1, spill = cx.createRadialGradient(sx, H * 0.12, 0, sx, H * 0.12, W * 0.55);
    spill.addColorStop(0, 'rgba(255,247,232,0.20)'); spill.addColorStop(1, 'rgba(255,247,232,0)');
    cx.fillStyle = spill; cx.fillRect(0, 0, W, H);
  }
  var grainTiles = null;
  function grain() {
    if (!grainTiles) {
      grainTiles = [];
      var seed = 7;
      for (var n = 0; n < 1; n++) {
        var c = document.createElement('canvas'); c.width = c.height = 192;
        var g2 = c.getContext('2d'), img = g2.createImageData(192, 192);
        for (var q = 0; q < img.data.length; q += 4) {
          seed = (seed * 1103515245 + 12345) >>> 0;
          var v = (seed >>> 16) & 255;
          img.data[q] = img.data[q + 1] = img.data[q + 2] = v; img.data[q + 3] = 255;
        }
        g2.putImageData(img, 0, 0); grainTiles.push(cx.createPattern(c, 'repeat'));
      }
    }
    cx.save(); cx.setTransform(1, 0, 0, 1, 0, 0);
    // A FIXED sensor texture, not one that boils every frame: noise that
    // changes per frame cannot be predicted by the encoder and eats the file's
    // bitrate. Laid on plainly (measured on @sparticuz/chromium, a 26.5 s story
    // at 540p: overlay blending 65 s, plain 56 s, none 56 s).
    cx.globalAlpha = 0.03; cx.globalCompositeOperation = 'source-over';
    cx.fillStyle = grainTiles[0]; cx.fillRect(0, 0, cv.width, cv.height);
    cx.restore();
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
    var hh = handheld(curT);
    cx.save(); cx.translate(W / 2, H / 2); cx.rotate(hh.r); cx.translate(-W / 2, -H / 2);
    cx.drawImage(im, (W - w) / 2 + dx + hh.x, (H - h) / 2 + dy + hh.y, w, h);
    cx.restore();
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
  // THE LOOK in the frame. With no theme and the lower template, every value
  // here is the one this player always drew (the code renderer's tests read it).
  var TT = LOOK.t || { case: 'none', weight: 700, tracking: '0', scale: 1, italic: false, price: 'pill', button: 'pill', radius: 0, align: 'center' };
  var TM = LOOK.m || { cut: 'fade', progress: 'segments', name: 'tl' };
  var TPL = LOOK.template || 'lower';
  var themed = !!LOOK.t;
  function caseOf(t) { return TT.case === 'upper' ? String(t || '').toUpperCase() : String(t || ''); }
  function headFont(px) { return (TT.italic ? 'italic ' : '') + (themed ? TT.weight : 700) + ' ' + px + 'px ' + D.fonts.head; }
  function spacing(px) {
    if (!('letterSpacing' in cx)) return;
    var m = String(TT.tracking || '0').match(/^(-?[\d.]+)em$/);
    cx.letterSpacing = m ? Math.round(parseFloat(m[1]) * px * 10) / 10 + 'px' : '0px';
  }
  function unspacing() { if ('letterSpacing' in cx) cx.letterSpacing = '0px'; }
  // The photograph inside a rectangle (a frame, a half): the same eased move and
  // the same hand-held drift as a full frame, clipped to its box.
  function photoIn(im, move, p, R, rad) {
    cx.save(); roundRect(R.x, R.y, R.w, R.h, rad || 0); cx.clip();
    var e = p * p * (3 - 2 * p), k = 1.06, dx = 0, dy = 0;
    if (move === 'push-in') k = 1.04 + 0.1 * e;
    else if (move === 'pull-out') k = 1.14 - 0.1 * e;
    else if (move === 'pan-right') { k = 1.12; dx = (e - 0.5) * -0.08 * R.w; }
    else if (move === 'pan-left') { k = 1.12; dx = (e - 0.5) * 0.08 * R.w; }
    else if (move === 'rise') { k = 1.12; dy = (e - 0.5) * 0.06 * R.h; }
    var r = Math.max(R.w / im.width, R.h / im.height) * k, w = im.width * r, h = im.height * r;
    var hh = handheld(curT);
    cx.translate(R.x + R.w / 2, R.y + R.h / 2); cx.rotate(hh.r); cx.translate(-R.w / 2, -R.h / 2);
    cx.drawImage(im, (R.w - w) / 2 + dx + hh.x, (R.h - h) / 2 + dy + hh.y, w, h);
    cx.restore();
    cx.save(); roundRect(R.x, R.y, R.w, R.h, rad || 0); cx.clip();
    phoneLight(D.scenes.indexOf(curScene) % 2);
    cx.restore();
  }
  // The price, in the theme's shape: a pill, a round sticker, a square block, or words.
  function price(text, x, y, align, fg) {
    var sz = TT.price === 'text' ? 60 : 64;
    cx.font = '700 ' + sz + 'px ' + D.fonts.body; var tw = cx.measureText(text).width;
    var cxp = align === 'left' ? x + (tw + 80) / 2 : x;
    if (TT.price === 'text') {
      cx.fillStyle = fg; cx.textAlign = align === 'left' ? 'left' : 'center'; cx.fillText(text, x, y + 74);
      cx.fillRect(align === 'left' ? x : x - tw / 2, y + 92, tw, 5); cx.textAlign = 'center'; return 110;
    }
    cx.fillStyle = D.pal.accent;
    if (TT.price === 'sticker') { var rr = Math.max(tw / 2 + 40, 92); cx.beginPath(); cx.arc(cxp, y + 10 + rr, rr, 0, Math.PI * 2); cx.fill(); cx.fillStyle = D.pal.on_accent; cx.textAlign = 'center'; cx.fillText(text, cxp, y + 10 + rr + 22); return rr * 2 + 20; }
    roundRect(cxp - (tw + 80) / 2, y + 10, tw + 80, 104, TT.price === 'block' ? 0 : 52); cx.fill();
    cx.fillStyle = D.pal.on_accent; cx.textAlign = 'center'; cx.fillText(text, cxp, y + 84); return 124;
  }
  // The button on the end card, in the theme's shape.
  function button(text, x, y, align, fill, label) {
    cx.font = '700 58px ' + D.fonts.body; var bw = cx.measureText(text).width + 140;
    var bx = align === 'left' ? x : x - bw / 2;
    var r = TT.button === 'pill' || !themed ? 65 : (TT.button === 'block' ? 0 : Math.min(24, (TT.radius || 0) * 1.5));
    if (TT.button === 'link') {
      cx.fillStyle = fill; cx.textAlign = align === 'left' ? 'left' : 'center'; cx.fillText(text + ' →', align === 'left' ? x : x, y + 90);
      var lw = cx.measureText(text + ' →').width; cx.fillRect(align === 'left' ? x : x - lw / 2, y + 108, lw, 5); cx.textAlign = 'center'; return;
    }
    if (TT.button === 'outline') { cx.strokeStyle = fill; cx.lineWidth = 6; roundRect(bx, y, bw, 130, r); cx.stroke(); cx.fillStyle = fill; }
    else { cx.fillStyle = fill; roundRect(bx, y, bw, 130, r); cx.fill(); cx.fillStyle = label; }
    cx.textAlign = 'center'; cx.fillText(text, bx + bw / 2, y + 85);
  }
  // Lines of the headline at x, starting at y; returns the y under the last line.
  function lines(text, x, y, big, maxW, align, fg) {
    spacing(big);
    var ls = wrap(caseOf(text), maxW, headFont(big));
    cx.fillStyle = fg; cx.textAlign = align === 'left' ? 'left' : 'center';
    ls.forEach(function (l, i) { cx.fillText(l, x, y + i * big * 1.15); });
    unspacing(); cx.textAlign = 'center';
    return y + ls.length * big * 1.15;
  }
  var curScene = null;
  function scene(sc, p, alpha) {
    curScene = sc;
    cx.globalAlpha = alpha;
    var im = sc.image && imgs[sc.image];
    var rise = Math.max(0, 1 - p * 4) * 40, tA = Math.min(1, p * 4) * alpha;
    var big0 = sc.kind === 'end' ? 88 : (sc.kind === 'product' ? 72 : 84);
    var big = themed ? Math.round(big0 * Math.max(0.85, Math.min(1.35, TT.scale))) : big0;
    if (sc.kind === 'end') return endCard(sc, p, alpha, rise, big);
    if (TPL === 'lower' || !im) {
      if (!im) { cx.fillStyle = D.pal.primary; cx.fillRect(0, 0, W, H); }
      else {
        cover(im, sc.move, p);
        phoneLight(D.scenes.indexOf(sc) % 2);
        if (sc.sweep) sweep(p);
        var g = cx.createLinearGradient(0, H * 0.45, 0, H);
        g.addColorStop(0, hexA(D.pal.ink, 0)); g.addColorStop(1, hexA(D.pal.ink, 0.72));
        cx.fillStyle = g; cx.fillRect(0, 0, W, H);
      }
      var fg = im ? '#ffffff' : D.pal.on_primary;
      cx.globalAlpha = tA; cx.textAlign = 'center';
      spacing(big);
      var ls = wrap(caseOf(sc.headline), W - 160, headFont(big));
      cx.fillStyle = fg;
      var y = H - 420 - (ls.length - 1) * big * 1.15;
      ls.forEach(function (l, i) { cx.fillText(l, W / 2, y + rise + i * big * 1.15); });
      unspacing();
      y += ls.length * big * 1.15;
      if (sc.price) price(sc.price, W / 2, y + rise, 'center', fg);
      nameMark(fg, alpha);
      return;
    }
    var fgP = D.pal.on_primary;
    if (TPL === 'title') {
      cx.fillStyle = D.pal.primary; cx.fillRect(0, 0, W, H);
      var R = { x: 90, y: 230, w: 900, h: 1000 };
      photoIn(im, sc.move, p, R, (TT.radius || 0) * 3);
      if (sc.sweep) { cx.save(); roundRect(R.x, R.y, R.w, R.h, (TT.radius || 0) * 3); cx.clip(); sweep(p); cx.restore(); }
      cx.globalAlpha = tA;
      var y2 = lines(sc.headline, W / 2, 1360 + rise, Math.min(big, 76), W - 180, 'center', fgP);
      if (sc.price) price(sc.price, W / 2, y2 - 20 + rise, 'center', fgP);
    } else if (TPL === 'split') {
      var R2 = { x: 0, y: 0, w: W, h: 1080 };
      photoIn(im, sc.move, p, R2, 0);
      if (sc.sweep) { cx.save(); roundRect(0, 0, W, 1080, 0); cx.clip(); sweep(p); cx.restore(); }
      var gs = cx.createLinearGradient(0, 0, 0, 260);
      gs.addColorStop(0, hexA(D.pal.ink, 0.62)); gs.addColorStop(1, hexA(D.pal.ink, 0));
      cx.fillStyle = gs; cx.fillRect(0, 0, W, 260);
      cx.fillStyle = D.pal.primary; cx.fillRect(0, 1080, W, H - 1080);
      cx.fillStyle = D.pal.accent; cx.fillRect(80, 1150, 140, 10);
      cx.globalAlpha = tA;
      var y3 = lines(sc.headline, 80, 1290 + rise, Math.min(big, 80), W - 160, 'left', fgP);
      if (sc.price) price(sc.price, 80, y3 - 20 + rise, 'left', fgP);
      nameMark('#ffffff', alpha); cx.globalAlpha = 1; return;
    } else if (TPL === 'editorial') {
      cover(im, sc.move, p);
      phoneLight(D.scenes.indexOf(sc) % 2);
      if (sc.sweep) sweep(p);
      var gt = cx.createLinearGradient(0, 0, 0, H * 0.62);
      gt.addColorStop(0, hexA(D.pal.ink, 0.78)); gt.addColorStop(1, hexA(D.pal.ink, 0));
      cx.fillStyle = gt; cx.fillRect(0, 0, W, H);
      cx.globalAlpha = tA;
      cx.fillStyle = '#ffffff'; cx.textAlign = 'left';
      if ('letterSpacing' in cx) cx.letterSpacing = '8px';
      cx.font = '600 34px ' + D.fonts.body; cx.fillText(String(D.name || '').toUpperCase(), 80, 200);
      unspacing();
      cx.fillRect(80, 232, 120, 4);
      var y4 = lines(sc.headline, 80, 330 + rise, Math.min(big, 80), W - 200, 'left', '#ffffff');
      if (sc.price) price(sc.price, 80, y4 - 20 + rise, 'left', '#ffffff');
      cx.globalAlpha = 1; return;
    } else if (TPL === 'frame') {
      cx.fillStyle = D.pal.primary; cx.fillRect(0, 0, W, H);
      var R3 = { x: 120, y: 200, w: 840, h: 1020 };
      cx.fillStyle = D.pal.accent; roundRect(R3.x + 34, R3.y + 34, R3.w, R3.h, (TT.radius || 0) * 2); cx.fill();
      photoIn(im, sc.move, p, R3, (TT.radius || 0) * 2);
      if (sc.sweep) { cx.save(); roundRect(R3.x, R3.y, R3.w, R3.h, (TT.radius || 0) * 2); cx.clip(); sweep(p); cx.restore(); }
      cx.globalAlpha = tA;
      cx.fillStyle = D.pal.accent; cx.fillRect(0, 1300, W, 96);
      cx.fillStyle = D.pal.on_accent; cx.textAlign = 'center';
      if ('letterSpacing' in cx) cx.letterSpacing = '6px';
      cx.font = '700 40px ' + D.fonts.body; cx.fillText(String(D.name || '').toUpperCase(), W / 2, 1362);
      unspacing();
      var y5 = lines(sc.headline, W / 2, 1500 + rise, Math.min(big, 70), W - 180, 'center', fgP);
      if (sc.price) price(sc.price, W / 2, y5 - 20 + rise, 'center', fgP);
      cx.globalAlpha = 1; return;
    }
    nameMark(fgP, alpha);
    cx.globalAlpha = 1;
  }
  // The brand's name on a scene: top-left, or top-centre for the themes that centre.
  function nameMark(fg, alpha) {
    cx.globalAlpha = alpha; cx.fillStyle = fg; cx.font = '700 44px ' + D.fonts.head;
    if (D.name) {
      if (TM.name === 'tc') { cx.textAlign = 'center'; cx.fillText(TT.case === 'upper' ? D.name.toUpperCase() : D.name, W / 2, 150); }
      else { cx.textAlign = 'left'; cx.fillText(D.name, 64, 150); }
    }
    cx.textAlign = 'left'; cx.globalAlpha = 1;
  }
  // The end card: a centred stack, a left-aligned page, or a split card.
  function endCard(sc, p, alpha0, rise, big) {
    cx.fillStyle = D.pal.primary; cx.fillRect(0, 0, W, H);
    var alpha = Math.min(1, p * 4) * alpha0;
    var fg = D.pal.on_primary;
    if (TPL === 'editorial' || (themed && TT.align === 'left' && TPL !== 'split')) {
      cx.globalAlpha = alpha; cx.fillStyle = fg; cx.textAlign = 'left';
      cx.font = headFont(64); cx.fillText(caseOf(D.name), 96, 420);
      cx.fillRect(96, 470, 160, 6);
      var y = lines(sc.headline, 96, 640 + rise, big, W - 192, 'left', fg);
      button(sc.cta, 96, y + 60, 'left', TT.button === 'outline' || TT.button === 'link' ? fg : D.pal.surface, D.pal.primary);
      if (sc.sub) { cx.fillStyle = fg; cx.textAlign = 'left'; cx.font = '500 44px ' + D.fonts.body; cx.fillText(sc.sub, 96, y + 300); }
      cx.textAlign = 'left'; cx.globalAlpha = 1; return;
    }
    if (TPL === 'split') {
      cx.fillStyle = D.pal.surface; cx.fillRect(0, H * 0.56, W, H * 0.44);
      cx.globalAlpha = alpha; cx.fillStyle = fg; cx.textAlign = 'center';
      cx.font = headFont(64); cx.fillText(caseOf(D.name), W / 2, 380);
      lines(sc.headline, W / 2, 640 + rise, big, W - 160, 'center', fg);
      button(sc.cta, W / 2, H * 0.56 + 170, 'center', D.pal.primary, D.pal.on_primary === D.pal.surface ? D.pal.surface : D.pal.on_primary);
      if (sc.sub) { cx.fillStyle = D.pal.on_accent; cx.textAlign = 'center'; cx.font = '500 44px ' + D.fonts.body; cx.fillText(sc.sub, W / 2, H * 0.56 + 420); }
      cx.textAlign = 'left'; cx.globalAlpha = 1; return;
    }
    // The centred stack (the player's own end card), framed for the frame template.
    if (TPL === 'frame') { cx.strokeStyle = fg; cx.lineWidth = 4; cx.strokeRect(48, 48, W - 96, H - 96); }
    cx.globalAlpha = alpha; cx.textAlign = 'center';
    spacing(big);
    var ls = wrap(caseOf(sc.headline), W - 160, headFont(big));
    cx.fillStyle = fg;
    var y0 = H * 0.40;
    ls.forEach(function (l, i) { cx.fillText(l, W / 2, y0 + rise + i * big * 1.15); });
    unspacing();
    y0 += ls.length * big * 1.15;
    if (themed) button(sc.cta, W / 2, y0 + 60, 'center', TT.button === 'outline' || TT.button === 'link' ? fg : D.pal.surface, D.pal.primary);
    else {
      cx.font = '700 58px ' + D.fonts.body; var bw = cx.measureText(sc.cta).width + 140;
      cx.fillStyle = D.pal.surface; roundRect(W / 2 - bw / 2, y0 + 60, bw, 130, 65); cx.fill();
      cx.fillStyle = D.pal.primary; cx.fillText(sc.cta, W / 2, y0 + 145);
    }
    if (sc.sub) { cx.fillStyle = fg; cx.font = '500 44px ' + D.fonts.body; cx.fillText(sc.sub, W / 2, y0 + 290); }
    cx.globalAlpha = alpha0;
    if (D.name) { cx.textAlign = 'center'; cx.fillStyle = fg; cx.font = themed ? headFont(64) : '700 64px ' + D.fonts.head; cx.fillText(themed ? caseOf(D.name) : D.name, W / 2, H * 0.30); }
    cx.textAlign = 'left'; cx.globalAlpha = 1;
  }
  function roundRect(x, y, w, h, r) { r = Math.max(0, Math.min(r || 0, w / 2, h / 2)); cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }
  function frame(t) {
    curT = t;
    cx.clearRect(0, 0, W, H);
    var i = 0; while (i < D.scenes.length - 1 && t >= D.scenes[i + 1].start) i++;
    var sc = D.scenes[i], p = Math.min(1, (t - sc.start) / sc.seconds);
    scene(sc, p, 1);
    var nx = D.scenes[i + 1], left = sc.start + sc.seconds - t;
    // Into the next scene, the theme's way: a cross-fade, a wipe, a slide, or a plain cut.
    if (nx && left < 0.45) {
      var q = 1 - left / 0.45;
      if (TM.cut === 'fade') scene(nx, 0, q);
      else if (TM.cut === 'wipe') { cx.save(); cx.beginPath(); cx.rect(0, 0, W * q, H); cx.clip(); scene(nx, 0, 1); cx.restore(); }
      else if (TM.cut === 'slide') { cx.save(); cx.translate(W * (1 - q * q * (3 - 2 * q)), 0); cx.beginPath(); cx.rect(0, 0, W, H); cx.clip(); scene(nx, 0, 1); cx.restore(); }
    }
    grain();
    // Story progress: segments, one line, or dots.
    if (TM.progress === 'line') {
      var done = (t / Math.max(0.01, D.total));
      cx.fillStyle = 'rgba(255,255,255,0.35)'; cx.fillRect(48, 64, W - 96, 4);
      cx.fillStyle = '#ffffff'; cx.fillRect(48, 64, (W - 96) * Math.min(1, done), 4);
    } else if (TM.progress === 'dots') {
      var n = D.scenes.length, step = 34, x0 = W / 2 - (n - 1) * step / 2;
      D.scenes.forEach(function (s2, k) { cx.fillStyle = k <= i ? '#ffffff' : 'rgba(255,255,255,0.35)'; cx.beginPath(); cx.arc(x0 + k * step, 66, k === i ? 10 : 7, 0, Math.PI * 2); cx.fill(); });
    } else {
      var gap = 10, segW = (W - 96 - gap * (D.scenes.length - 1)) / D.scenes.length;
      D.scenes.forEach(function (s2, k) {
        var f = k < i ? 1 : (k === i ? p : 0);
        cx.fillStyle = 'rgba(255,255,255,0.35)'; cx.fillRect(48 + k * (segW + gap), 60, segW, 8);
        cx.fillStyle = '#ffffff'; cx.fillRect(48 + k * (segW + gap), 60, segW * f, 8);
      });
    }
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
    // The page holding this player in a sandboxed frame cannot read it, so the
    // chosen cut is told to it (its "MP4" export renders the same cut).
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'lifecycle-story-cut', cut: toShort ? 'short' : 'full' }, '*'); } catch (_) { /* no parent */ }
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
  // #rgb or #rrggbb only: the page's hexA() and the canvas read nothing else.
  const hex = (v, d) => (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || '')) ? v : d);
  const fam = (v) => String(v || 'system-ui, sans-serif').replace(/[^\w\s,'"-]/g, '').slice(0, 160);
  const p = (raw && raw.pal) || {};
  return {
    cuts: { full, short: cut(raw.cuts.short) },
    pal: { primary: hex(p.primary, '#333366'), on_primary: hex(p.on_primary, '#ffffff'), accent: hex(p.accent, '#ffffff'), on_accent: hex(p.on_accent, '#111111'), surface: hex(p.surface, '#ffffff'), ink: hex(p.ink, '#222222') },
    fonts: { head: fam(raw.fonts && raw.fonts.head), body: fam(raw.fonts && raw.fonts.body) },
    name: str(raw.name, 80),
    look: cleanLook({ theme: str(raw.look && raw.look.theme, 40), template: str(raw.look && raw.look.template, 40) }),
  };
}

module.exports = { renderStoryAd, storyPage, storyDataFrom, storyScenes, storyBrief, cleanLook, VIDEO_TEMPLATES, THEME_TABLE, MAX_SECONDS, SHORT_SECONDS, MOVES };
