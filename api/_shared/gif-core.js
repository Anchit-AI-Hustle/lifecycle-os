'use strict';

/**
 * api/_shared/gif-core.js — text → animated GIF for email.
 *
 * Email clients can't play <video>, so animated content ships as GIF. Per the
 * lifecycle-OS asset policy we DERIVE the GIF from a generated short video:
 *
 *   1. generate a short clip via video-core.js (cascade pinned to
 *      Higgsfield + OpenMontage first, then the rest);
 *   2. convert that clip to an optimised GIF via a small ffmpeg worker whose
 *      URL is GIF_CONVERT_URL (POST { video_url, fps, width, max_seconds }
 *      → { gif_url }). Deploying that worker is a one-liner ffmpeg container.
 *
 * Graceful degradation (Klaviyo / video-core pattern): if no video key exists,
 * or GIF_CONVERT_URL is unset, we return a { connected:false } stub that still
 * carries the source video_url (when we got one) so the caller can ship the
 * clip and add the GIF later — nothing throws.
 */

const video = require('./video-core.js');

const CONVERT_URL = (process.env.GIF_CONVERT_URL || '').trim();
const DEFAULT_PREFER = ['higgsfield', 'openmontage', 'veo', 'sora', 'runway'];

async function _postJson(url, body, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    const text = await r.text().catch(() => '');
    let data; try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: String(e.message || e) } };
  } finally { clearTimeout(t); }
}

/**
 * generateGif({ prompt, duration_s?, aspect?, tier?, fps?, width? })
 *   → { ok, gif_url }                         (converted)
 *   → { ok, provider, job_id, status, ... }   (video still processing — poll then convertFromVideo)
 *   → { ok:false, connected:false, not_connected:true, video_url?, hint }
 */
async function generateGif({ prompt, duration_s = 3, aspect = '1:1', tier = 'standard', fps = 12, width = 480 } = {}) {
  const p = String(prompt || '').trim();
  if (!p) return { ok: false, error: 'prompt required' };

  const vid = await video.generateVideo({
    prompt: p, duration_s: Math.min(duration_s, 6), aspect, tier, preferProviders: DEFAULT_PREFER,
  });

  if (!vid || vid.not_connected) {
    return { ok: false, connected: false, not_connected: true,
      hint: 'No video provider key set — GIF derives from a generated clip. ' + (vid && vid.hint || ''),
      would_request: vid && vid.would_request };
  }
  if (!vid.ok) return { ok: false, error: vid.error || 'video generation failed', attempts: vid.attempts };

  if (vid.status === 'processing') {
    // Hand back the video job; caller polls video-status then calls convertFromVideo.
    return { ok: true, status: 'processing', source: 'video', provider: vid.provider, job_id: vid.job_id, convert_pending: true };
  }

  if (vid.video_url) return convertFromVideo({ video_url: vid.video_url, fps, width, duration_s });
  return { ok: false, error: 'video completed without a url' };
}

// Convert an already-produced video URL into a GIF via the ffmpeg worker.
async function convertFromVideo({ video_url, fps = 12, width = 480, duration_s = 3 } = {}) {
  if (!video_url) return { ok: false, error: 'video_url required' };
  if (!CONVERT_URL) {
    return { ok: false, connected: false, not_connected: true, video_url,
      would_request: { method: 'POST', url: '<GIF_CONVERT_URL>', body: { video_url, fps, width, max_seconds: duration_s } },
      hint: 'Set GIF_CONVERT_URL to an ffmpeg worker (POST {video_url,fps,width,max_seconds} -> {gif_url}). Meanwhile the source clip is at video_url.' };
  }
  const r = await _postJson(CONVERT_URL, { video_url, fps, width, max_seconds: duration_s });
  const gifUrl = r.ok && r.data && (r.data.gif_url || r.data.url);
  if (gifUrl) return { ok: true, gif_url: gifUrl, source_video_url: video_url };
  return { ok: false, error: 'gif conversion failed: HTTP ' + r.status, video_url };
}

function isConnected() { return video.isConnected(); }

module.exports = { generateGif, convertFromVideo, isConnected };
