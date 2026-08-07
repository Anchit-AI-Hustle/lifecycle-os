// Reels-grade MOTION AD renderer + motion brief.
//
// Two outputs from the same scene data:
//   1. renderMotionAd(spec)  -> a self-contained 9:16 animated HTML creative
//      (layered Ken Burns, parallax veils, scene crossfades, kinetic
//      typography, lava progress bar) — instant in-browser preview of the ad,
//      no renderer/API needed. Screen-record or hand off for the MP4.
//   2. motionBrief(spec)     -> a generator-ready brief (Higgsfield
//      image-to-video / Marketing Studio, or an editor like CapCut): per-scene
//      camera moves, durations, transitions and kinetic-type timings, so the
//      SAME motion design ships as a real video.
//
// Quality bar (what makes it read like a real Reel, not a slideshow):
//   - hook inside the first second (scale-in + type punch, no dead air),
//   - every scene MOVES (slow push/pan — never a static still),
//   - typography animates in words/lines with stagger, not all at once,
//   - scene rhythm ~2-3s with soft crossfades, hard cut only into the CTA,
//   - one grade across scenes (the brand veil), safe-areas respected.
//
// Brand: palette #D0473E / #6A33D8 / #111111 / #FFFFFF only; Montserrat serif
// headlines + Instrument Sans body (with fallbacks); no banned phrases (the
// caller passes copy that already went through sanitizeBrand()).

'use strict';

const PALETTE = { green: '#D0473E', lava: '#6A33D8', ink: '#111111', chalk: '#FFFFFF' };
// NOTE: the historic var names are kept for callers; `green` now carries the brand
// PRIMARY (lava red #D0473E) and `lava` the SECONDARY (drip purple), matching the
// live knickgasm.com theme.

// Original, royalty-free brand audio beds (synthesized by scripts/gen-brand-audio.py).
// Every motion/video ad ships with a bed so exports are never silent.
const AUDIO = {
  hero:       '/assets/media/knickgasm-brand-beat.wav',      // 32s full bed
  reels:      '/assets/media/knickgasm-reels-loop.wav',      // 16s cutdown
  underscore: '/assets/media/knickgasm-ad-underscore.wav',   // 22s under-VO bed
};
function audioTrack(spec) {
  if (spec && spec.audio === false) return null;             // explicit opt-out
  if (spec && typeof spec.audio === 'string') return spec.audio;  // caller override
  const total = spec && spec.__totalSeconds;
  if (spec && spec.voiceover) return AUDIO.underscore;
  return total && total <= 18 ? AUDIO.reels : AUDIO.hero;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Camera moves cycled across scenes so consecutive scenes never repeat.
const MOVES = [
  { name: 'push-in',   from: 'scale(1.02) translate(0%, 0%)',   to: 'scale(1.14) translate(0%, -1.5%)' },
  { name: 'drift-left', from: 'scale(1.12) translate(1.5%, 0%)', to: 'scale(1.12) translate(-1.5%, 0%)' },
  { name: 'pull-back', from: 'scale(1.16) translate(0%, -1%)',  to: 'scale(1.04) translate(0%, 0.5%)' },
  { name: 'drift-up',  from: 'scale(1.12) translate(0%, 1.5%)', to: 'scale(1.12) translate(0%, -1.5%)' }
];

function normalizeScenes(spec) {
  const scenes = (spec.scenes || []).filter(s => s && (s.image || s.headline));
  if (!scenes.length) throw new Error('motion-ad: at least one scene ({image, headline}) is required');
  return scenes.map((s, i) => ({
    image: s.image || '',
    alt: s.alt || spec.product || 'KNICKGASM sneaker',
    headline: s.headline || '',
    sub: s.sub || '',
    seconds: Math.max(1.6, Math.min(4, Number(s.seconds) || 2.6)),
    move: MOVES[i % MOVES.length]
  }));
}

/**
 * Render the self-contained animated HTML creative.
 * spec: { product, scenes: [{image, headline, sub, seconds, alt}],
 *         cta, offer, footnote, loop (default true) }
 */
function renderMotionAd(spec) {
  const scenes = normalizeScenes(spec);
  const total = scenes.reduce((a, s) => a + s.seconds, 0) + 2.2; // + CTA card
  const loop = spec.loop !== false;
  let t = 0;
  const sceneCss = [];
  const sceneHtml = [];
  scenes.forEach((s, i) => {
    const start = t; t += s.seconds;
    const startPct = (start / total) * 100;
    const endPct = (t / total) * 100;
    const fade = Math.min(8, (0.45 / total) * 100); // ~0.45s crossfade
    sceneCss.push(`
    #sc${i} { animation: vis${i} ${total}s ${loop ? 'infinite' : '1 forwards'} linear; }
    #sc${i} .ken { animation: ken${i} ${total}s ${loop ? 'infinite' : '1 forwards'} linear; }
    @keyframes vis${i} {
      0%, ${Math.max(0, startPct - fade).toFixed(2)}% { opacity: 0; }
      ${Math.min(100, startPct + fade).toFixed(2)}%, ${Math.max(0, endPct - fade).toFixed(2)}% { opacity: 1; }
      ${Math.min(100, endPct + fade).toFixed(2)}%, 100% { opacity: 0; }
    }
    @keyframes ken${i} {
      0%, ${startPct.toFixed(2)}% { transform: ${s.move.from}; }
      ${endPct.toFixed(2)}%, 100% { transform: ${s.move.to}; }
    }
    #sc${i} .kin { animation: kin${i} ${total}s ${loop ? 'infinite' : '1 forwards'} linear; }
    @keyframes kin${i} {
      0%, ${startPct.toFixed(2)}% { opacity: 0; transform: translateY(18px); }
      ${Math.min(100, startPct + fade * 1.4).toFixed(2)}%, ${Math.max(0, endPct - fade).toFixed(2)}% { opacity: 1; transform: translateY(0); }
      ${Math.min(100, endPct + fade).toFixed(2)}%, 100% { opacity: 0; transform: translateY(-10px); }
    }`);
    const bg = s.image
      ? `<img class="ken" src="${esc(s.image)}" alt="${esc(s.alt)}">`
      : `<div class="ken solid"></div>`;
    sceneHtml.push(`
  <section class="scene" id="sc${i}">
    ${bg}
    <div class="veil"></div>
    <div class="type">
      <h2 class="kin">${esc(s.headline)}</h2>
      ${s.sub ? `<p class="kin" style="animation-delay:.12s">${esc(s.sub)}</p>` : ''}
    </div>
  </section>`);
  });
  const ctaStart = ((total - 2.2) / total) * 100;
  const track = audioTrack(Object.assign({ __totalSeconds: total }, spec));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.product || 'KNICKGASM')} — motion ad</title>
<style>
  :root { --green:${PALETTE.green}; --lava:${PALETTE.lava}; --ink:${PALETTE.ink}; --chalk:${PALETTE.chalk}; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--ink); display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .stage { position:relative; width:min(100vw, calc(100vh * 9 / 16)); aspect-ratio:9/16;
           overflow:hidden; background:var(--green);
           font-family:'Instrument Sans','Helvetica Neue',Arial,sans-serif; }
  .scene { position:absolute; inset:0; opacity:0; }
  .scene img, .scene .solid { position:absolute; inset:-4%; width:108%; height:108%;
           object-fit:cover; will-change:transform; }
  .scene .solid { background:radial-gradient(120% 90% at 50% 30%, #0a5c38 0%, var(--green) 70%); }
  .veil { position:absolute; inset:0;
          background:linear-gradient(180deg, rgba(23,23,23,.42) 0%, rgba(23,23,23,0) 34%,
                     rgba(0,74,43,0) 55%, rgba(0,74,43,.62) 100%); }
  .type { position:absolute; left:7%; right:7%; top:9%; }
  .type h2 { font-family:'Montserrat','Raleway',Georgia,serif; font-weight:700;
             color:var(--chalk); font-size:clamp(26px, 8.5vmin, 54px); line-height:1.12;
             text-shadow:0 2px 22px rgba(23,23,23,.45); }
  .type p { color:var(--chalk); opacity:.94; font-size:clamp(14px, 3.6vmin, 22px);
            margin-top:10px; text-shadow:0 1px 14px rgba(23,23,23,.5); }
  .kin { opacity:0; will-change:transform,opacity; }
  .cta { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
         justify-content:center; gap:16px; text-align:center; padding:0 9%;
         background:radial-gradient(130% 100% at 50% 20%, #0a5c38 0%, var(--green) 72%);
         opacity:0; animation:ctain ${total}s ${loop ? 'infinite' : '1 forwards'} linear; }
  @keyframes ctain { 0%, ${Math.max(0, ctaStart - 2).toFixed(2)}% { opacity:0; }
                     ${Math.min(100, ctaStart + 1.5).toFixed(2)}%, 100% { opacity:1; } }
  .cta h3 { font-family:'Montserrat','Raleway',Georgia,serif; color:var(--chalk);
            font-size:clamp(24px, 7.6vmin, 46px); line-height:1.15; }
  .cta .offer { color:var(--lava); font-size:clamp(15px, 4vmin, 24px); letter-spacing:.04em; }
  .cta .btn { display:inline-block; background:var(--lava); color:var(--ink); font-weight:700;
              padding:14px 34px; border-radius:999px; font-size:clamp(14px, 3.8vmin, 20px); }
  .cta .fn { color:var(--chalk); opacity:.7; font-size:clamp(10px, 2.6vmin, 13px); }
  .bar { position:absolute; left:0; bottom:0; height:4px; background:var(--lava); width:0;
         animation:bar ${total}s ${loop ? 'infinite' : '1 forwards'} linear; }
  @keyframes bar { from { width:0 } to { width:100% } }
  @media (prefers-reduced-motion: reduce) {
    .ken, .kin, .cta, .bar { animation-duration: 0.01s !important; animation-iteration-count: 1 !important; }
    .kin, .cta { opacity: 1 !important; transform: none !important; }
  }
  .sound { position:absolute; right:5%; top:4%; z-index:5; border:0; cursor:pointer;
           background:rgba(17,17,17,.55); color:var(--chalk); font:600 11px/1 'Instrument Sans',Arial,sans-serif;
           letter-spacing:.12em; padding:8px 11px; border-radius:999px; backdrop-filter:blur(4px); }
</style></head>
<body>
<div class="stage" role="img" aria-label="${esc(spec.product || 'KNICKGASM')} advertisement">
${sceneHtml.join('\n')}
${sceneCss.length ? `<style>${sceneCss.join('\n')}</style>` : ''}
  <div class="cta">
    <h3>${esc(spec.ctaHeadline || spec.cta || 'Lace-up something better')}</h3>
    ${spec.offer ? `<div class="offer">${esc(spec.offer)}</div>` : ''}
    <span class="btn">${esc(spec.cta || 'Shop now')}</span>
    ${spec.footnote ? `<div class="fn">${esc(spec.footnote)}</div>` : ''}
  </div>
  <div class="bar"></div>
${track ? `  <audio id="bed" src="${track}" ${loop ? 'loop' : ''} preload="auto" autoplay muted></audio>
  <button class="sound" type="button" aria-label="Toggle sound">SOUND ON</button>` : ''}
</div>
${track ? `<script>
  (function(){
    var a=document.getElementById('bed'), b=document.querySelector('.sound');
    if(!a||!b) return;
    // Browsers block audible autoplay: start muted, let the first tap unmute —
    // the same pattern Reels/TikTok previews use.
    b.addEventListener('click', function(){
      a.muted=!a.muted; b.textContent=a.muted?'SOUND ON':'SOUND OFF';
      if(!a.muted){ a.currentTime=0; a.play().catch(function(){}); }
    });
    document.addEventListener('visibilitychange', function(){
      if(document.hidden) a.pause(); else if(!a.muted) a.play().catch(function(){});
    });
  })();
</script>` : ''}
</body></html>`;
}

/**
 * Generator/editor handoff: the SAME motion design as a structured brief.
 * Feed each scene's image + prompt to Higgsfield image-to-video (or
 * generate_video), then assemble per the timeline.
 */
function motionBrief(spec) {
  const total = normalizeScenes(spec).reduce((a, s) => a + s.seconds, 0) + 2.2;
  const scenes = normalizeScenes(spec);
  let t = 0;
  const shots = scenes.map((s, i) => {
    const start = +t.toFixed(2); t += s.seconds;
    return {
      shot: i + 1,
      start_s: start,
      duration_s: s.seconds,
      source_image: s.image || '[generate via /api/ai/image mode=reels]',
      camera: s.move.name,
      video_prompt: `Cinematic ${s.move.name.replace('-', ' ')} over the provided frame, ` +
        'subtle organic motion only (steam rising, gentle light shift), filmic grade, ' +
        'no added objects, no text, no logos, 9:16.',
      kinetic_type: { text: s.headline, sub: s.sub || null, in: 'rise+fade, word stagger 80ms', out: 'fade up' },
      transition_out: i === scenes.length - 1 ? 'hard cut to CTA card' : 'crossfade 0.45s'
    };
  });
  return {
    format: '1080x1920 (9:16) MP4, keep total under 15s for Reels',
    product: spec.product || '',
    grade: 'one filmic grade across all shots; brand veil deep-purple to ink, lava accents',
    hook_rule: 'first shot must move within 0.8s; type punches in with it',
    audio: {
      bed: audioTrack(Object.assign({ __totalSeconds: total }, spec)),
      note: 'KNICKGASM-owned original bed (scripts/gen-brand-audio.py) - 90 BPM, F minor, ' +
            'seamless loop, royalty-free for paid use. Never rip a trending sound for a paid ad.',
      mix: 'bed at -18 LUFS under voiceover, -14 LUFS music-forward; duck 6 dB under any VO; ' +
           'hard-out on the CTA card downbeat',
      captions: 'burn in captions - most feed views start muted',
    },
    shots,
    cta_card: { duration_s: 2.2, headline: spec.ctaHeadline || spec.cta || 'Lace-up something better',
                offer: spec.offer || null, button: spec.cta || 'Shop now',
                background: 'deep-purple radial, lava button, chalk serif headline' },
    safe_areas: 'keep type inside 7% side margins; nothing critical in bottom 18% (UI overlap)'
  };
}

module.exports = { renderMotionAd, motionBrief, PALETTE, AUDIO, audioTrack };
