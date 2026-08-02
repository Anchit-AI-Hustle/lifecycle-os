'use strict';

/**
 * api/_shared/asset-agent.js — the Mailer Asset Agent.
 *
 * Reads the embedded `<!-- IMAGE|VIDEO|GIF GENERATION PROMPT (...) -->` comments
 * that every lava-standard mailer carries (see mailer-format.js), generates the
 * real asset for each, and swaps it into the matching paste-placeholder:
 *
 *   IMAGE → api/ai/image.js cascade via creative-image.js
 *           (premium tier hits gpt-image-2 "img-gen-2" then Gemini
 *            gemini-3-pro-image "nano-banana-2"), uploaded to Supabase Storage.
 *   VIDEO → video-core.js cascade, pinned to Higgsfield + OpenMontage first.
 *           Async: completed clips are swapped in; still-processing jobs are
 *           returned in `pending` for the caller to poll via video-status.
 *   GIF   → gif-core.js (short clip → ffmpeg-worker GIF).
 *
 * Everything degrades gracefully: a slot that can't be produced (no key,
 * provider down) is left as its placeholder and reported — the mailer still
 * ships. Nothing here throws on provider failure.
 *
 * Wired in as the `generate_mailer_assets` KicksGPT tool (brand-llm.js) and the
 * `?action=mailer-assets` / `?action=mailer-assets-status` brain routes.
 */

const MF = require('./mailer-format.js');
const creative = require('./creative-image.js');
const video = require('./video-core.js');
const gif = require('./gif-core.js');

const VIDEO_PREFER = ['higgsfield', 'openmontage', 'veo', 'sora', 'runway'];

// Parse every embedded generation-prompt comment into structured slots.
// Each carries the source-string offset (`at`) so fills can be position-aware.
function parseAssetPrompts(html) {
  const out = [];
  const re = new RegExp(MF.ASSET_PROMPT_RE.source, 'gi');
  let m;
  while ((m = re.exec(String(html || '')))) {
    out.push({
      kind: m[1].toLowerCase(),
      slot: m[2].trim(),
      displayW: parseInt(m[3], 10),
      displayH: parseInt(m[4], 10),
      genW: parseInt(m[5], 10),
      genH: parseInt(m[6], 10),
      prompt: m[7].replace(/\s+/g, ' ').trim(),
      at: m.index,
    });
  }
  return out;
}

// Pair each paste-placeholder with the nearest generation-prompt comment of the
// SAME kind that precedes it (each prompt used at most once). Handles the
// common 1:1 adjacent case AND hand-authored mailers where some prompts (e.g. an
// "optional hero") carry no placeholder. Returns [{ token, prompt }] in
// document order — one per placeholder occurrence.
function pairPlaceholders(html, prompts) {
  const h = String(html || '');
  const pairs = [];
  for (const kind of ['image', 'video', 'gif']) {
    const token = MF.PLACEHOLDER[kind];
    const avail = prompts.filter((p) => p.kind === kind).sort((a, b) => a.at - b.at);
    const used = new Set();
    let idx = h.indexOf(token);
    while (idx !== -1) {
      // nearest preceding, still-unused prompt of this kind
      let pick = null;
      for (const p of avail) {
        if (used.has(p) || p.at > idx) continue;
        if (!pick || p.at > pick.at) pick = p;
      }
      if (!pick) pick = avail.find((p) => !used.has(p)) || null; // fallback: any unused
      if (pick) used.add(pick);
      pairs.push({ token, kind, pos: idx, prompt: pick });
      idx = h.indexOf(token, idx + token.length);
    }
  }
  return pairs;
}

function aspectFor(w, h) {
  if (!w || !h) return '1:1';
  const r = w / h;
  if (r > 1.35) return '16:9';
  if (r < 0.75) return '9:16';
  return '1:1';
}

// Replace placeholder tokens of one kind with resolved URLs, in document order
// (i-th prompt of that kind → i-th placeholder of that kind).
function replaceInOrder(html, token, urls) {
  let i = 0;
  return html.replace(new RegExp(token, 'g'), () => {
    const u = urls[i++];
    return u || token; // leave placeholder if this slot couldn't be produced
  });
}

/**
 * fillMailerAssets(html, { tier, market, persist, video: doVideo, gif: doGif })
 *   → { ok, html, assets:[{slot,kind,status,url|provider|job_id,error}],
 *       pending:[{slot,kind,provider,job_id}], counts, unresolved }
 */
async function fillMailerAssets(html, {
  tier = 'premium', market = 'UK', persist = true,
  video: doVideo = true, gif: doGif = true, name = 'mailer',
} = {}) {
  let out = String(html || '');
  const prompts = parseAssetPrompts(out);
  const pairs = pairPlaceholders(out, prompts);
  if (!pairs.length) {
    return { ok: true, html: out, assets: [], pending: [], counts: { image: 0, video: 0, gif: 0 }, unresolved: MF.pendingPlaceholders(out), note: 'no fillable asset slots found' };
  }

  const assets = [];
  const pending = [];
  const slotOf = (pr, kind) => (pr.prompt && pr.prompt.slot) || kind;

  // ── Images (parallel) ──────────────────────────────────────────────────────
  const imgPairs = pairs.filter((p) => p.kind === 'image');
  const imgUrls = await Promise.all(imgPairs.map(async (pr) => {
    const slot = slotOf(pr, 'image');
    if (!pr.prompt) { assets.push({ slot, kind: 'image', status: 'skipped', error: 'placeholder with no matching prompt' }); return null; }
    try {
      const gen = await creative.generateCreativeImage(pr.prompt.prompt, { size: `${pr.prompt.genW}x${pr.prompt.genH}`, mode: 'design' });
      if (!gen || !gen.image) { assets.push({ slot, kind: 'image', status: 'failed', error: 'no image from cascade' }); return null; }
      let url = gen.image;
      if (persist) {
        const hosted = await creative.uploadCreative(gen.image, `${name}-${slot}`);
        if (hosted) url = hosted;
      }
      assets.push({ slot, kind: 'image', status: 'done', provider: gen.provider, model: gen.model, url, hosted: url !== gen.image });
      return url;
    } catch (e) {
      assets.push({ slot, kind: 'image', status: 'failed', error: String(e.message || e).slice(0, 200) });
      return null;
    }
  }));
  out = replaceInOrder(out, MF.PLACEHOLDER.image, imgUrls);

  // ── Videos (async cascade; completed swapped in, processing → pending) ───────
  const vidPairs = doVideo ? pairs.filter((p) => p.kind === 'video') : [];
  const vidUrls = await Promise.all(vidPairs.map(async (pr) => {
    const slot = slotOf(pr, 'video');
    if (!pr.prompt) { assets.push({ slot, kind: 'video', status: 'skipped' }); return null; }
    try {
      const r = await video.generateVideo({ prompt: pr.prompt.prompt, aspect: aspectFor(pr.prompt.genW, pr.prompt.genH), tier, duration_s: 8, preferProviders: VIDEO_PREFER });
      if (r && r.not_connected) { assets.push({ slot, kind: 'video', status: 'not_connected', hint: r.hint }); return null; }
      if (r && r.status === 'processing') { pending.push({ slot, kind: 'video', provider: r.provider, job_id: r.job_id }); assets.push({ slot, kind: 'video', status: 'processing', provider: r.provider, job_id: r.job_id }); return null; }
      if (r && r.ok && r.video_url) { assets.push({ slot, kind: 'video', status: 'done', provider: r.provider, url: r.video_url }); return r.video_url; }
      assets.push({ slot, kind: 'video', status: 'failed', error: (r && r.error) || 'unknown' });
      return null;
    } catch (e) {
      assets.push({ slot, kind: 'video', status: 'failed', error: String(e.message || e).slice(0, 200) });
      return null;
    }
  }));
  out = replaceInOrder(out, MF.PLACEHOLDER.video, vidUrls);

  // ── GIFs (video-derived) ─────────────────────────────────────────────────────
  const gifPairs = doGif ? pairs.filter((p) => p.kind === 'gif') : [];
  const gifUrls = await Promise.all(gifPairs.map(async (pr) => {
    const slot = slotOf(pr, 'gif');
    if (!pr.prompt) { assets.push({ slot, kind: 'gif', status: 'skipped' }); return null; }
    try {
      const r = await gif.generateGif({ prompt: pr.prompt.prompt, aspect: aspectFor(pr.prompt.genW, pr.prompt.genH), tier, duration_s: 3, width: Math.min(pr.prompt.genW, 600) });
      if (r && r.gif_url) { assets.push({ slot, kind: 'gif', status: 'done', url: r.gif_url }); return r.gif_url; }
      if (r && r.convert_pending) { pending.push({ slot, kind: 'gif', provider: r.provider, job_id: r.job_id, needs_convert: true }); assets.push({ slot, kind: 'gif', status: 'processing', provider: r.provider, job_id: r.job_id }); return null; }
      if (r && r.not_connected) { assets.push({ slot, kind: 'gif', status: 'not_connected', hint: r.hint, video_url: r.video_url }); return r.video_url || null; }
      assets.push({ slot, kind: 'gif', status: 'failed', error: (r && r.error) || 'unknown' });
      return null;
    } catch (e) {
      assets.push({ slot, kind: 'gif', status: 'failed', error: String(e.message || e).slice(0, 200) });
      return null;
    }
  }));
  out = replaceInOrder(out, MF.PLACEHOLDER.gif, gifUrls);

  const done = assets.filter((a) => a.status === 'done').length;
  return {
    ok: true, html: out, assets, pending,
    counts: { image: imgPairs.length, video: vidPairs.length, gif: gifPairs.length },
    done_count: done,
    unresolved: MF.pendingPlaceholders(out),
  };
}

module.exports = { parseAssetPrompts, fillMailerAssets, aspectFor };
