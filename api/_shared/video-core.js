'use strict';

/**
 * api/_shared/video-core.js — Video generation cascade for KNICKGASM (NEW capability).
 *
 * Cascade (blueprint docs/quality-upgrade-blueprint.md, July 2026):
 *   1. Veo 3.1   `veo-3.1-generate-preview`  — Gemini API predictLongRunning + poll
 *                (reuses GEMINI_API_KEY; paid tier)
 *   2. Sora 2    `sora-2`                    — OpenAI /v1/videos (OPENAI_API_KEY;
 *                note: API sunset 2026-09-24)
 *   3. Higgsfield Cloud REST                 — HIGGSFIELD_API_KEY (+ optional
 *                HIGGSFIELD_API_SECRET), ~$0.10/s, paid plans
 *   4. Runway    `gen4_turbo`                — RUNWAY_API_KEY, ~$0.05/s floor
 *
 * Async job model:
 *   generateVideo({ prompt, duration_s, aspect, tier })
 *     → { ok, provider, job_id, status, video_url? }        (job submitted)
 *   getVideoStatus({ provider, job_id })
 *     → { ok, provider, job_id, status, video_url? }        (poll until 'completed')
 *
 * Graceful degradation (Klaviyo pattern — see api/_shared/klaviyo-core.js):
 *   • a rung whose key is missing is SKIPPED;
 *   • when NO video key exists at all, returns
 *       { ok:false, connected:false, not_connected:true,
 *         would_request:{ provider, method, url, body }, hint }
 *     for the best rung, so chat/tool-calling work end-to-end key-free.
 *
 * Any synchronous wait is time-boxed to SYNC_WAIT_MS (20s) — after that the
 * caller gets { status:'processing' } and polls via getVideoStatus.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OPENAI_BASE = 'https://api.openai.com/v1';
const HIGGSFIELD_BASE = 'https://cloud.higgsfield.ai/v1';
const OPENMONTAGE_BASE = (process.env.OPENMONTAGE_BASE || 'https://api.openmontage.ai/v1').replace(/\/+$/, '');
const RUNWAY_BASE = 'https://api.dev.runwayml.com/v1';
const RUNWAY_VERSION = '2024-11-06';

const VEO_MODEL = process.env.VEO_VIDEO_MODEL || 'veo-3.1-generate-preview';
const SORA_MODEL = process.env.SORA_VIDEO_MODEL || 'sora-2';
const RUNWAY_MODEL = process.env.RUNWAY_VIDEO_MODEL || 'gen4_turbo';

const SYNC_WAIT_MS = 20000;   // hard cap on synchronous waiting inside one call
const POLL_EVERY_MS = 5000;

function keys() {
  const clean = s => (s || '').replace(/[﻿​ ]/g, '').trim(); // strip BOM/zero-width (Vercel env)
  return {
    gemini: clean(process.env.GEMINI_API_KEY),
    openai: clean(process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_2 || process.env.OPENAI_API_KEY_3),
    higgsfield: clean(process.env.HIGGSFIELD_API_KEY),
    higgsfieldSecret: clean(process.env.HIGGSFIELD_API_SECRET),
    openmontage: clean(process.env.OPENMONTAGE_API_KEY),
    runway: clean(process.env.RUNWAY_API_KEY),
  };
}

function anyKey() {
  const k = keys();
  return !!(k.gemini || k.openai || k.higgsfield || k.openmontage || k.runway);
}

// Map generic aspect ratios per provider.
function normAspect(aspect) {
  const a = String(aspect || '16:9').trim();
  return (a === '9:16' || a === '1:1' || a === '16:9') ? a : '16:9';
}

async function _fetchJson(url, { method = 'GET', headers = {}, body = null, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await r.text().catch(() => '');
    let data; try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
    return { ok: r.ok, status: r.status, data, errText: r.ok ? '' : text.substring(0, 300) };
  } catch (e) {
    return { ok: false, status: 0, data: null, errText: e.name === 'AbortError' ? ('timeout after ' + timeoutMs + 'ms') : String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Rung request builders (also used for the { would_request } stub) ─────────

function veoRequest({ prompt, aspect }) {
  return {
    provider: 'veo',
    method: 'POST',
    url: GEMINI_BASE + '/models/' + VEO_MODEL + ':predictLongRunning',
    body: {
      instances: [{ prompt }],
      parameters: { aspectRatio: normAspect(aspect) },
    },
  };
}

function soraRequest({ prompt, duration_s, aspect }) {
  const a = normAspect(aspect);
  const size = a === '9:16' ? '720x1280' : a === '1:1' ? '720x720' : '1280x720';
  return {
    provider: 'sora',
    method: 'POST',
    url: OPENAI_BASE + '/videos',
    body: { model: SORA_MODEL, prompt, seconds: String(Math.min(Math.max(Math.round(duration_s || 8), 4), 12)), size },
  };
}

function higgsfieldRequest({ prompt, duration_s, aspect }) {
  return {
    provider: 'higgsfield',
    method: 'POST',
    url: HIGGSFIELD_BASE + '/text2video',
    body: { prompt, duration: Math.min(Math.max(Math.round(duration_s || 8), 3), 15), aspect_ratio: normAspect(aspect) },
  };
}

function openMontageRequest({ prompt, duration_s, aspect }) {
  return {
    provider: 'openmontage',
    method: 'POST',
    url: OPENMONTAGE_BASE + '/text2video',
    body: { prompt, duration_s: Math.min(Math.max(Math.round(duration_s || 8), 3), 30), aspect_ratio: normAspect(aspect) },
  };
}

function runwayRequest({ prompt, duration_s, aspect }) {
  const a = normAspect(aspect);
  const ratio = a === '9:16' ? '720:1280' : a === '1:1' ? '960:960' : '1280:720';
  return {
    provider: 'runway',
    method: 'POST',
    url: RUNWAY_BASE + '/image_to_video',
    body: { model: RUNWAY_MODEL, promptText: prompt, ratio, duration: (duration_s || 8) <= 5 ? 5 : 10 },
  };
}

// ── Rung executors — each returns { ok, provider, job_id, status, video_url?, error? }
//    or null-ish { ok:false, error } to demote to the next rung. ──────────────

async function runVeo(opts) {
  const k = keys();
  const reqSpec = veoRequest(opts);
  const r = await _fetchJson(reqSpec.url + '?key=' + encodeURIComponent(k.gemini), {
    method: 'POST', body: reqSpec.body,
  });
  if (!r.ok) return { ok: false, provider: 'veo', error: 'HTTP ' + r.status + ': ' + r.errText };
  const opName = r.data && r.data.name;
  if (!opName) return { ok: false, provider: 'veo', error: 'no operation name in response' };
  // Time-boxed sync wait: poll a couple of times, then hand back the job id.
  const deadline = Date.now() + SYNC_WAIT_MS - POLL_EVERY_MS;
  while (Date.now() < deadline) {
    await _sleep(POLL_EVERY_MS);
    const st = await statusVeo(opName);
    if (st.status === 'completed' || st.status === 'failed') return st;
  }
  return { ok: true, provider: 'veo', job_id: opName, status: 'processing' };
}

async function statusVeo(jobId) {
  const k = keys();
  if (!k.gemini) return _notConnected({ provider: 'veo', method: 'GET', url: GEMINI_BASE + '/' + jobId, body: undefined });
  const r = await _fetchJson(GEMINI_BASE + '/' + jobId + '?key=' + encodeURIComponent(k.gemini));
  if (!r.ok) return { ok: false, provider: 'veo', job_id: jobId, status: 'unknown', error: 'HTTP ' + r.status + ': ' + r.errText };
  const d = r.data || {};
  if (d.error) return { ok: false, provider: 'veo', job_id: jobId, status: 'failed', error: (d.error.message || JSON.stringify(d.error)).substring(0, 300) };
  if (!d.done) return { ok: true, provider: 'veo', job_id: jobId, status: 'processing' };
  const resp = d.response || {};
  const gen = resp.generateVideoResponse || resp;
  const sample = (gen.generatedSamples && gen.generatedSamples[0]) || (gen.generatedVideos && gen.generatedVideos[0]) || null;
  const uri = sample && ((sample.video && sample.video.uri) || sample.uri || sample.videoUri) || null;
  return { ok: true, provider: 'veo', job_id: jobId, status: 'completed', video_url: uri, model: VEO_MODEL };
}

async function runSora(opts) {
  const k = keys();
  const reqSpec = soraRequest(opts);
  const r = await _fetchJson(reqSpec.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + k.openai },
    body: reqSpec.body,
  });
  if (!r.ok) return { ok: false, provider: 'sora', error: 'HTTP ' + r.status + ': ' + r.errText };
  const id = r.data && r.data.id;
  if (!id) return { ok: false, provider: 'sora', error: 'no job id in response' };
  const deadline = Date.now() + SYNC_WAIT_MS - POLL_EVERY_MS;
  while (Date.now() < deadline) {
    await _sleep(POLL_EVERY_MS);
    const st = await statusSora(id);
    if (st.status === 'completed' || st.status === 'failed') return st;
  }
  return { ok: true, provider: 'sora', job_id: id, status: 'processing' };
}

async function statusSora(jobId) {
  const k = keys();
  if (!k.openai) return _notConnected({ provider: 'sora', method: 'GET', url: OPENAI_BASE + '/videos/' + jobId, body: undefined });
  const r = await _fetchJson(OPENAI_BASE + '/videos/' + encodeURIComponent(jobId), { headers: { Authorization: 'Bearer ' + k.openai } });
  if (!r.ok) return { ok: false, provider: 'sora', job_id: jobId, status: 'unknown', error: 'HTTP ' + r.status + ': ' + r.errText };
  const d = r.data || {};
  const raw = String(d.status || '').toLowerCase();
  if (raw === 'completed' || raw === 'succeeded') {
    // Binary is fetched from the content endpoint (requires the same bearer key).
    return { ok: true, provider: 'sora', job_id: jobId, status: 'completed', video_url: OPENAI_BASE + '/videos/' + jobId + '/content', model: SORA_MODEL };
  }
  if (raw === 'failed' || raw === 'cancelled') {
    return { ok: false, provider: 'sora', job_id: jobId, status: 'failed', error: (d.error && d.error.message) || raw };
  }
  return { ok: true, provider: 'sora', job_id: jobId, status: 'processing' };
}

function _higgsfieldHeaders(k) {
  return {
    'hf-api-key': k.higgsfield,
    ...(k.higgsfieldSecret ? { 'hf-secret': k.higgsfieldSecret } : {}),
  };
}

async function runHiggsfield(opts) {
  const k = keys();
  const reqSpec = higgsfieldRequest(opts);
  const r = await _fetchJson(reqSpec.url, { method: 'POST', headers: _higgsfieldHeaders(k), body: reqSpec.body });
  if (!r.ok) return { ok: false, provider: 'higgsfield', error: 'HTTP ' + r.status + ': ' + r.errText };
  const id = r.data && (r.data.id || r.data.job_id || (r.data.job_set && r.data.job_set.id));
  if (!id) return { ok: false, provider: 'higgsfield', error: 'no job id in response' };
  return { ok: true, provider: 'higgsfield', job_id: String(id), status: 'processing' };
}

async function statusHiggsfield(jobId) {
  const k = keys();
  if (!k.higgsfield) return _notConnected({ provider: 'higgsfield', method: 'GET', url: HIGGSFIELD_BASE + '/jobs/' + jobId, body: undefined });
  const r = await _fetchJson(HIGGSFIELD_BASE + '/jobs/' + encodeURIComponent(jobId), { headers: _higgsfieldHeaders(k) });
  if (!r.ok) return { ok: false, provider: 'higgsfield', job_id: jobId, status: 'unknown', error: 'HTTP ' + r.status + ': ' + r.errText };
  const d = r.data || {};
  const raw = String(d.status || d.state || '').toLowerCase();
  const url = (d.result && (d.result.url || d.result.video_url)) || d.video_url || null;
  if (raw === 'completed' || raw === 'succeeded' || url) return { ok: true, provider: 'higgsfield', job_id: jobId, status: 'completed', video_url: url };
  if (raw === 'failed' || raw === 'error') return { ok: false, provider: 'higgsfield', job_id: jobId, status: 'failed', error: d.error || raw };
  return { ok: true, provider: 'higgsfield', job_id: jobId, status: 'processing' };
}

// OpenMontage — generic async REST (bearer auth). Endpoint shape is
// env-overridable via OPENMONTAGE_BASE; on any auth/endpoint mismatch the rung
// simply demotes to the next provider, so it is safe to enable incrementally.
async function runOpenMontage(opts) {
  const k = keys();
  const reqSpec = openMontageRequest(opts);
  const r = await _fetchJson(reqSpec.url, {
    method: 'POST', headers: { Authorization: 'Bearer ' + k.openmontage }, body: reqSpec.body,
  });
  if (!r.ok) return { ok: false, provider: 'openmontage', error: 'HTTP ' + r.status + ': ' + r.errText };
  const id = r.data && (r.data.id || r.data.job_id || r.data.task_id);
  const url = r.data && (r.data.video_url || (r.data.result && r.data.result.video_url));
  if (url) return { ok: true, provider: 'openmontage', job_id: String(id || ''), status: 'completed', video_url: url };
  if (!id) return { ok: false, provider: 'openmontage', error: 'no job id in response' };
  return { ok: true, provider: 'openmontage', job_id: String(id), status: 'processing' };
}

async function statusOpenMontage(jobId) {
  const k = keys();
  if (!k.openmontage) return _notConnected({ provider: 'openmontage', method: 'GET', url: OPENMONTAGE_BASE + '/jobs/' + jobId, body: undefined });
  const r = await _fetchJson(OPENMONTAGE_BASE + '/jobs/' + encodeURIComponent(jobId), { headers: { Authorization: 'Bearer ' + k.openmontage } });
  if (!r.ok) return { ok: false, provider: 'openmontage', job_id: jobId, status: 'unknown', error: 'HTTP ' + r.status + ': ' + r.errText };
  const d = r.data || {};
  const raw = String(d.status || d.state || '').toLowerCase();
  const url = (d.result && (d.result.url || d.result.video_url)) || d.video_url || null;
  if (raw === 'completed' || raw === 'succeeded' || url) return { ok: true, provider: 'openmontage', job_id: jobId, status: 'completed', video_url: url };
  if (raw === 'failed' || raw === 'error') return { ok: false, provider: 'openmontage', job_id: jobId, status: 'failed', error: d.error || raw };
  return { ok: true, provider: 'openmontage', job_id: jobId, status: 'processing' };
}

async function runRunway(opts) {
  const k = keys();
  const reqSpec = runwayRequest(opts);
  const r = await _fetchJson(reqSpec.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + k.runway, 'X-Runway-Version': RUNWAY_VERSION },
    body: reqSpec.body,
  });
  if (!r.ok) return { ok: false, provider: 'runway', error: 'HTTP ' + r.status + ': ' + r.errText };
  const id = r.data && r.data.id;
  if (!id) return { ok: false, provider: 'runway', error: 'no task id in response' };
  return { ok: true, provider: 'runway', job_id: String(id), status: 'processing' };
}

async function statusRunway(jobId) {
  const k = keys();
  if (!k.runway) return _notConnected({ provider: 'runway', method: 'GET', url: RUNWAY_BASE + '/tasks/' + jobId, body: undefined });
  const r = await _fetchJson(RUNWAY_BASE + '/tasks/' + encodeURIComponent(jobId), {
    headers: { Authorization: 'Bearer ' + k.runway, 'X-Runway-Version': RUNWAY_VERSION },
  });
  if (!r.ok) return { ok: false, provider: 'runway', job_id: jobId, status: 'unknown', error: 'HTTP ' + r.status + ': ' + r.errText };
  const d = r.data || {};
  const raw = String(d.status || '').toUpperCase();
  if (raw === 'SUCCEEDED') return { ok: true, provider: 'runway', job_id: jobId, status: 'completed', video_url: (Array.isArray(d.output) && d.output[0]) || null, model: RUNWAY_MODEL };
  if (raw === 'FAILED' || raw === 'CANCELLED') return { ok: false, provider: 'runway', job_id: jobId, status: 'failed', error: d.failure || d.failureCode || raw };
  return { ok: true, provider: 'runway', job_id: jobId, status: 'processing' };
}

function _notConnected(wouldRequest) {
  return {
    ok: false, connected: false, not_connected: true,
    would_request: wouldRequest,
    hint: 'Set GEMINI_API_KEY (Veo 3.1), OPENAI_API_KEY (Sora 2), HIGGSFIELD_API_KEY, OPENMONTAGE_API_KEY, or RUNWAY_API_KEY in Vercel env to execute this for real. The request shape above is what will be sent.',
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * generateVideo({ prompt, duration_s?, aspect?, tier? })
 * Cascades Veo 3.1 → Sora 2 → Higgsfield → Runway; skips rungs without keys.
 * With NO keys at all, returns the Klaviyo-style { connected:false, would_request }
 * stub for the best rung (Veo 3.1).
 */
// KNICKGASM-owned original audio beds (scripts/gen-brand-audio.py). Text-to-video
// providers return SILENT clips, so every generated video carries the bed to lay
// under it in the edit — a paid video ad must never ship silent, and a licensed
// or trending track is never an option for paid media.
const AUDIO_BEDS = {
  hero:       '/assets/media/knickgasm-brand-beat.wav',
  reels:      '/assets/media/knickgasm-reels-loop.wav',
  underscore: '/assets/media/knickgasm-ad-underscore.wav',
};
function audioBedFor(duration_s, { voiceover = false } = {}) {
  const bed = voiceover ? AUDIO_BEDS.underscore : (duration_s <= 18 ? AUDIO_BEDS.reels : AUDIO_BEDS.hero);
  return {
    bed,
    origin: 'KNICKGASM original (royalty-free, cleared for paid media)',
    spec: '90 BPM, F minor, seamless loop',
    mix: voiceover ? 'bed -18 LUFS, duck 6 dB under VO' : 'music-forward -14 LUFS',
    note: 'Generated video arrives SILENT — lay this bed under it in the edit and burn in captions.',
  };
}

async function generateVideo({ prompt, duration_s = 8, aspect = '16:9', tier = 'standard', preferProviders = null, voiceover = false } = {}) {
  const p = String(prompt || '').trim();
  if (!p) return { ok: false, error: 'prompt required' };
  const opts = { prompt: p, duration_s, aspect };
  const audio = audioBedFor(duration_s, { voiceover });
  const k = keys();

  if (!anyKey()) {
    // Best rung's exact request shape — honour the caller's first preference.
    const first = (preferProviders && preferProviders[0]) || 'veo';
    const shape = { higgsfield: higgsfieldRequest, openmontage: openMontageRequest, sora: soraRequest, runway: runwayRequest, veo: veoRequest }[first] || veoRequest;
    return Object.assign(_notConnected(shape(opts)), { audio });
  }

  let rungs = [
    { name: 'veo', hasKey: !!k.gemini, run: runVeo },
    { name: 'sora', hasKey: !!k.openai, run: runSora },
    { name: 'higgsfield', hasKey: !!k.higgsfield, run: runHiggsfield },
    { name: 'openmontage', hasKey: !!k.openmontage, run: runOpenMontage },
    { name: 'runway', hasKey: !!k.runway, run: runRunway },
  ];

  // Caller can reorder the cascade (e.g. the mailer asset agent pins
  // Higgsfield + OpenMontage first per the lifecycle-OS video policy).
  if (Array.isArray(preferProviders) && preferProviders.length) {
    const rank = (n) => { const i = preferProviders.indexOf(n); return i === -1 ? 99 : i; };
    rungs = rungs.slice().sort((a, b) => rank(a.name) - rank(b.name));
  }

  const attempts = [];
  for (const rung of rungs) {
    if (!rung.hasKey) { attempts.push({ provider: rung.name, skipped: 'no key' }); continue; }
    console.log('[video] Trying ' + rung.name + ' (tier=' + tier + ')');
    try {
      const out = await rung.run(opts);
      if (out && out.ok) return { ...out, tier, attempts };
      attempts.push({ provider: rung.name, error: (out && out.error) || 'unknown failure' });
      console.warn('[video] ' + rung.name + ' failed: ' + ((out && out.error) || 'unknown') + ' — demoting');
    } catch (e) {
      attempts.push({ provider: rung.name, error: String(e.message || e).substring(0, 200) });
      console.warn('[video] ' + rung.name + ' exception — demoting: ' + String(e.message || e).substring(0, 200));
    }
  }
  return { ok: false, error: 'All video providers failed', attempts, tier };
}

/**
 * getVideoStatus({ provider, job_id }) — poll a job started by generateVideo.
 * status: 'processing' | 'completed' | 'failed' | 'unknown'.
 */
async function getVideoStatus({ provider, job_id } = {}) {
  const prov = String(provider || '').toLowerCase().trim();
  const id = String(job_id || '').trim();
  if (!id) return { ok: false, error: 'job_id required' };
  switch (prov) {
    case 'veo': case 'gemini': return statusVeo(id);
    case 'sora': case 'openai': return statusSora(id);
    case 'higgsfield': return statusHiggsfield(id);
    case 'openmontage': return statusOpenMontage(id);
    case 'runway': return statusRunway(id);
    default:
      return { ok: false, error: "Unknown video provider '" + provider + "'", available: ['veo', 'sora', 'higgsfield', 'openmontage', 'runway'] };
  }
}

function isConnected() { return anyKey(); }

module.exports = { generateVideo, getVideoStatus, isConnected, AUDIO_BEDS, audioBedFor };
