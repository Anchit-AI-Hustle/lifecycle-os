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
 * Graceful degradation:
 *   • a rung whose key is missing is SKIPPED;
 *   • when NO video key exists at all, or every configured rung fails, returns
 *     the code-rendered rung (2026-10-17): { ok:true, provider:'code-motion',
 *     status:'rendered', motion_html, motion_brief, mp4:null, note } - an
 *     animated 9:16 HTML creative from scripts/lib/motion-ad.js, with the
 *     provider request it would have sent as `would_request` when keyless.
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

// Pollo AI (2026-10-25, docs.pollo.ai read that day): POST
// /v1/generation/kling-ai/kling-v2-5-turbo/video with `x-api-key`, then GET
// /v1/generation/{taskId}/status until generations[0].status is succeed or
// failed. Kling 2.5 Turbo takes duration 5 or 10; image-to-video takes the
// first frame as an http(s) image URL and no aspect ratio (the photo's own);
// text-to-video takes aspectRatio 16:9 / 9:16 / 1:1. Outputs are kept 14 days.
// The key is ONLY the workspace's own (workspace-connections-core, category
// 'media'): no platform env key is read.
const POLLO_BASE = 'https://pollo.ai/api/platform';
const POLLO_MODEL = 'kling-ai/kling-v2-5-turbo';
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

async function polloKey() {
  try {
    const m = await require('./workspace-connections-core.js').mediaKeysForCurrentRequest();
    return (m && m.pollo && m.pollo.api_key) || '';
  } catch (_) { return ''; }
}

function polloRequest({ prompt, duration_s, aspect, image }) {
  const duration = Number(duration_s) > 7 ? 10 : 5;
  const input = /^https?:\/\/[^\s"'<>]+$/i.test(String(image || ''))
    ? { image: String(image), prompt: String(prompt).slice(0, 1500), duration, mode: 'std' }
    : { prompt: String(prompt).slice(0, 1500), aspectRatio: normAspect(aspect), duration };
  return { provider: 'pollo', method: 'POST', url: POLLO_BASE + '/v1/generation/' + POLLO_MODEL + '/video', body: { input } };
}

async function runPollo(opts, key) {
  const rq = polloRequest(opts);
  const r = await _fetchJson(rq.url, { method: 'POST', headers: { 'x-api-key': key }, body: rq.body, timeoutMs: _submitMs(opts) });
  if (!r.ok) return { ok: false, provider: 'pollo', error: 'HTTP ' + r.status + ': ' + polloError(r) };
  const id = r.data && r.data.taskId;
  if (!id) return { ok: false, provider: 'pollo', error: 'no taskId in response' };
  // The work is billed to the workspace's own Pollo account: recorded as its
  // own answer, so the credit meter charges this app's credits for none of it.
  try { require('./request-scope.js').noteLlm('ok', { own: true, kind: 'video', provider: 'pollo', model: POLLO_MODEL }); } catch (_) { /* no scope */ }
  return { ok: true, provider: 'pollo', job_id: String(id), status: 'processing', model: POLLO_MODEL, mode: rq.body.input.image ? 'image-to-video' : 'text-to-video', note: 'Pollo keeps the finished video for 14 days; download it before then.' };
}

function polloError(r) {
  const d = r && r.data;
  if (d && (d.errorCode || d.message)) return String(d.errorCode || '') + (d.message ? ' ' + String(d.message) : '');
  return String((r && r.errText) || '').slice(0, 200);
}

async function statusPollo(jobId) {
  const key = await polloKey();
  const url = POLLO_BASE + '/v1/generation/' + encodeURIComponent(jobId) + '/status';
  if (!key) return _notConnected({ provider: 'pollo', method: 'GET', url, body: undefined });
  const r = await _fetchJson(url, { headers: { 'x-api-key': key } });
  if (!r.ok) return { ok: false, provider: 'pollo', job_id: jobId, status: 'unknown', error: 'HTTP ' + r.status + ': ' + polloError(r) };
  const g = (r.data && Array.isArray(r.data.generations) && r.data.generations[0]) || null;
  if (!g) return { ok: true, provider: 'pollo', job_id: jobId, status: 'processing' };
  if (g.status === 'succeed' && g.url) return { ok: true, provider: 'pollo', job_id: jobId, status: 'completed', video_url: g.url, cover: g.cover || null, model: POLLO_MODEL };
  if (g.status === 'failed') return { ok: false, provider: 'pollo', job_id: jobId, status: 'failed', error: String(g.failMsg || 'failed').slice(0, 300) };
  return { ok: true, provider: 'pollo', job_id: jobId, status: 'processing' };
}

/** The account's credit balance: the connection check, which spends nothing. */
async function polloBalance(key) {
  const r = await _fetchJson(POLLO_BASE + '/v1/credit/balance', { headers: { 'x-api-key': key }, timeoutMs: 8000 });
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, available: Number(r.data && r.data.availableCredits) || 0 };
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

// A submit never waits longer than the call has left (opts.deadline, set by
// generateVideo from its budget), so one hanging provider cannot spend it all.
function _submitMs(opts) {
  const left = (opts && opts.deadline) ? opts.deadline - Date.now() : Infinity;
  return Math.max(1, Math.min(20000, left));
}

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

// The workspace's OWN Gemini connection (2026-10-25): an API key, or the
// access token Sign in with Google mints plus its project. Veo then runs on the
// person's own Google account, recorded as their own answer (no app credits).
async function ownGeminiAuth() {
  try {
    const ov = await require('./workspace-connections-core.js').llmOverridesForCurrentRequest();
    const k = ov && ov.keys;
    if (k && k.gemini) return { key: String(k.gemini) };
    if (k && k.gemini_oauth && k.gemini_oauth.access_token) return { bearer: k.gemini_oauth.access_token, project: k.gemini_oauth.project || '' };
  } catch (_) { /* no workspace */ }
  return null;
}
function geminiAuthed(url, auth) {
  if (auth && auth.bearer) return { url, headers: Object.assign({ Authorization: 'Bearer ' + auth.bearer }, auth.project ? { 'x-goog-user-project': auth.project } : {}) };
  return { url: url + (url.indexOf('?') >= 0 ? '&' : '?') + 'key=' + encodeURIComponent((auth && auth.key) || keys().gemini), headers: {} };
}

async function runVeo(opts, auth) {
  const reqSpec = veoRequest(opts);
  const a = geminiAuthed(reqSpec.url, auth);
  const r = await _fetchJson(a.url, {
    method: 'POST', headers: a.headers, body: reqSpec.body, timeoutMs: _submitMs(opts),
  });
  if (!r.ok) return { ok: false, provider: 'veo', error: 'HTTP ' + r.status + ': ' + r.errText };
  const opName = r.data && r.data.name;
  if (!opName) return { ok: false, provider: 'veo', error: 'no operation name in response' };
  // Time-boxed sync wait: poll a couple of times, then hand back the job id.
  const deadline = Math.min(Date.now() + SYNC_WAIT_MS - POLL_EVERY_MS, (opts.deadline || Infinity) - POLL_EVERY_MS);
  while (Date.now() < deadline) {
    await _sleep(POLL_EVERY_MS);
    const st = await statusVeo(opName, auth);
    if (st.status === 'completed' || st.status === 'failed') return st;
  }
  return { ok: true, provider: 'veo', job_id: opName, status: 'processing' };
}

async function statusVeo(jobId, auth) {
  const k = keys();
  const use = auth || await ownGeminiAuth();
  if (!use && !k.gemini) return _notConnected({ provider: 'veo', method: 'GET', url: GEMINI_BASE + '/' + jobId, body: undefined });
  const a = geminiAuthed(GEMINI_BASE + '/' + jobId, use);
  let r = await _fetchJson(a.url, { headers: a.headers });
  // A job started on the platform's key is not the workspace's to read.
  if (!r.ok && !auth && use && k.gemini && (r.status === 403 || r.status === 404)) {
    const pa = geminiAuthed(GEMINI_BASE + '/' + jobId, null);
    r = await _fetchJson(pa.url, { headers: pa.headers });
  }
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
    body: reqSpec.body, timeoutMs: _submitMs(opts),
  });
  if (!r.ok) return { ok: false, provider: 'sora', error: 'HTTP ' + r.status + ': ' + r.errText };
  const id = r.data && r.data.id;
  if (!id) return { ok: false, provider: 'sora', error: 'no job id in response' };
  const deadline = Math.min(Date.now() + SYNC_WAIT_MS - POLL_EVERY_MS, (opts.deadline || Infinity) - POLL_EVERY_MS);
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
  const r = await _fetchJson(reqSpec.url, { method: 'POST', headers: _higgsfieldHeaders(k), body: reqSpec.body, timeoutMs: _submitMs(opts) });
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
    method: 'POST', headers: { Authorization: 'Bearer ' + k.openmontage }, body: reqSpec.body, timeoutMs: _submitMs(opts),
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
    body: reqSpec.body, timeoutMs: _submitMs(opts),
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
/**
 * These files are ONE tenant's own recordings and are cleared for THAT tenant's
 * paid media. Handing them to another brand would be two failures at once: the
 * brand leak, and a licensing claim the other brand cannot stand behind, since
 * the clearance does not travel with the file.
 *
 * So a brand with no bed on file gets a marker, never a loan. Silence in the
 * edit is a problem the operator can see and solve; an unlicensed track in a
 * paid campaign is one they find out about later.
 */
function audioBedFor(duration_s, { voiceover = false, brand = null } = {}) {
  const zeroSlug = (() => {
    try { return String((require('./brand-runtime.js').defaultBrand() || {}).slug || ''); } catch (_) { return ''; }
  })();
  // The server's determination first (owns_shipped, stamped from the oldest
  // workspace); a workspace record that only carries tenant zero's slug is
  // not tenant zero, and its owner's bed is not licensed to it (2026-10-05).
  let decided = null;
  try { decided = brand ? require('./brand-catalog-server.js').isTenantZeroBrand(brand) : null; } catch (_) { decided = null; }
  const isZero = !brand || (decided !== null ? decided : (!brand.id && zeroSlug && String(brand.slug || '') === zeroSlug));

  if (!isZero) {
    const own = (brand && brand.audio_beds) || null;
    const bed = own && (voiceover ? own.underscore : (duration_s <= 18 ? own.reels : own.hero));
    if (!bed) {
      return {
        bed: null,
        origin: `[DATA REQUIRED BEFORE LAUNCH: brand audio bed, ${(brand && brand.name) || 'this brand'}]`,
        spec: '',
        mix: voiceover ? 'bed -18 LUFS, duck 6 dB under VO' : 'music-forward -14 LUFS',
        note: 'Generated video arrives SILENT. No audio bed is on file for this brand, and another brand\'s bed is not licensed for it. Supply an owned or licensed track before this ships as paid media.',
      };
    }
    return {
      bed,
      origin: `${brand.name || 'This brand'} owned (supplied on the brand record)`,
      spec: (brand.audio_beds && brand.audio_beds.spec) || '',
      mix: voiceover ? 'bed -18 LUFS, duck 6 dB under VO' : 'music-forward -14 LUFS',
      note: 'Generated video arrives SILENT — lay this bed under it in the edit and burn in captions.',
    };
  }

  const bed = voiceover ? AUDIO_BEDS.underscore : (duration_s <= 18 ? AUDIO_BEDS.reels : AUDIO_BEDS.hero);
  return {
    bed,
    origin: `${(brand && brand.name) || 'Tenant zero'} original (royalty-free, cleared for paid media)`,
    spec: '90 BPM, F minor, seamless loop',
    mix: voiceover ? 'bed -18 LUFS, duck 6 dB under VO' : 'music-forward -14 LUFS',
    note: 'Generated video arrives SILENT — lay this bed under it in the edit and burn in captions.',
  };
}

/**
 * THE KEYLESS RUNG (2026-10-17): a code-rendered motion creative.
 *
 * With no video key (or with every configured provider failing) this used to
 * answer `not_connected` and every surface showed a stub. The animated 9:16
 * creative `scripts/lib/motion-ad.js` renders needs no model and no key: the
 * brand's own palette and type, the photos the CALLER hands over (never one
 * invented here), and on-screen lines the caller wrote as customer copy. The
 * prompt is a production direction for a video model and is never put on
 * screen. With no line, the card is the brand's own name; with no photo, the
 * scene is the brand-coloured card motion-ad already draws. It is an animated
 * HTML document, not an MP4, and the answer says so (`mp4: null`).
 *
 * motion = { images?: [https url], lines?: [string], product?, cta?, ctaHeadline? }
 */
function _https(u) { return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u.trim()) ? u.trim() : ''; }
function codeMotion({ brand = null, motion = null, duration_s = 8, aspect = '9:16', reason = '', attempts = null, wouldRequest = null } = {}) {
  const rt = require('./brand-runtime.js');
  // The brand this request is for, else the request's own, else the
  // unresolved placeholder: never tenant zero by default.
  let b = null;
  try { b = rt.scopedBrand(brand); } catch (_) { b = brand || null; }
  b = b || rt.unresolvedBrand('no brand resolved for this video');
  const name = String(b.name || '').trim() || '[DATA REQUIRED BEFORE LAUNCH: brand name]';
  const m = motion && typeof motion === 'object' ? motion : {};
  const clean = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, 90);
  const isGap = (t) => /^\[DATA REQUIRED/.test(t);
  const images = (Array.isArray(m.images) ? m.images : []).map(_https).filter(Boolean).slice(0, 6);
  const lines = [];
  const push = (l) => { const v = clean(l); if (v && !isGap(v) && !lines.some((x) => x.toLowerCase() === v.toLowerCase())) lines.push(v); };
  (Array.isArray(m.lines) ? m.lines : []).forEach(push);
  const product = isGap(clean(m.product)) ? '' : clean(m.product);
  if (product) push(product);
  const beats = lines.slice(0, 3);
  const scenes = (beats.length ? beats : [name]).map((headline, i) => ({
    image: images.length ? images[i % images.length] : '',
    headline,
    seconds: 2.6,
  }));
  const audio = audioBedFor(Number(duration_s) || 8, { brand: b });
  let cta = clean(m.cta);
  if (!cta) { try { cta = require('./asset-playbooks.js').defaultCta(b, { hasProduct: !!product }); } catch (_) { cta = 'Learn more'; } }
  const spec = {
    brand: b,
    product,
    scenes,
    cta,
    // The end card names the brand: a creative over photos otherwise never does.
    ctaHeadline: clean(m.ctaHeadline) || name,
    audio: (audio && audio.bed) ? audio.bed : false,
    loop: true,
  };
  const motionAd = require('../../scripts/lib/motion-ad.js');
  const out = {
    ok: true, connected: false, provider: 'code-motion', status: 'rendered',
    format: 'text/html', aspect: '9:16',
    motion_html: motionAd.renderMotionAd(spec),
    motion_brief: motionAd.motionBrief(spec),
    video_url: null, mp4: null,
    images_used: Array.from(new Set(scenes.map((s) => s.image).filter(Boolean))),
    audio,
    note: 'Animated HTML creative rendered in code in ' + name + '\'s own palette' +
      (images.length ? ', over the photos supplied' : '; no photo was supplied, so each scene is the brand-coloured card') +
      '. It is not an MP4: ' + (reason || 'no video provider key is configured') + '.' +
      (String(aspect || '9:16') !== '9:16' ? ' Rendered at 9:16 (asked for ' + String(aspect) + ').' : ''),
  };
  if (attempts) out.attempts = attempts;
  if (wouldRequest) {
    out.would_request = wouldRequest;
    out.hint = 'Set GEMINI_API_KEY (Veo 3.1), OPENAI_API_KEY (Sora 2), HIGGSFIELD_API_KEY, OPENMONTAGE_API_KEY or RUNWAY_API_KEY for an MP4. would_request is what will be sent.';
  }
  return out;
}

async function generateVideo({ prompt, duration_s = 8, aspect = '16:9', tier = 'standard', preferProviders = null, voiceover = false, brand = null, budget_ms = 0, motion = null } = {}) {
  const p = String(prompt || '').trim();
  if (!p) return { ok: false, error: 'prompt required' };
  // One budget for the whole cascade (default 90s, inside a 120s function).
  const budget = Number(budget_ms) > 0 ? Number(budget_ms) : (Number(process.env.VIDEO_TOTAL_BUDGET_MS) > 0 ? Number(process.env.VIDEO_TOTAL_BUDGET_MS) : 90000);
  const opts = { prompt: p, duration_s, aspect, deadline: Date.now() + budget };
  const audio = audioBedFor(duration_s, { voiceover, brand });
  const k = keys();

  // The workspace's OWN Pollo key goes first, free generation or not: it is the
  // person's own spend, as an own image key is in api/ai/image.js. The product's
  // own photo (the first one the caller sent) is the first frame.
  const ownPollo = await polloKey();
  const pAttempts = [];
  if (ownPollo) {
    const image = motion && Array.isArray(motion.images) ? motion.images.find((u) => /^https?:\/\//i.test(String(u || ''))) : '';
    try {
      const out = await runPollo(Object.assign({}, opts, { image }), ownPollo);
      if (out.ok) return Object.assign({}, out, { tier, audio, attempts: [] });
      pAttempts.push({ provider: 'pollo', error: out.error });
    } catch (e) {
      pAttempts.push({ provider: 'pollo', error: String((e && e.message) || e).slice(0, 200) });
    }
  }

  // Then the workspace's OWN Gemini connection runs Veo, Google's video model
  // (2026-10-25, the operator: Gemini quality for every asset): their own
  // account pays, so it goes first, free generation or not.
  const ownG = await ownGeminiAuth();
  if (ownG) {
    try {
      const out = await runVeo(opts, ownG);
      if (out.ok) {
        try { require('./request-scope.js').noteLlm('ok', { own: true, kind: 'video', provider: 'gemini', model: VEO_MODEL }); } catch (_) { /* no scope */ }
        return Object.assign({}, out, { tier, audio, own: true, attempts: pAttempts });
      }
      pAttempts.push({ provider: 'veo', error: out.error });
    } catch (e) {
      pAttempts.push({ provider: 'veo', error: String((e && e.message) || e).slice(0, 200) });
    }
  }

  // FREE FIRST (2026-10-17, the operator: "everything will cost the user
  // credits - but it should be done for free in the backend"): with free
  // generation on, the creative is rendered in code and no paid video provider
  // is called, key or no key. FREE_GENERATION=off restores the provider cascade.
  const freeFirst = String(process.env.FREE_GENERATION || '').trim().toLowerCase() !== 'off';
  if (!anyKey() || freeFirst) {
    if (pAttempts.length) {
      const who = pAttempts[0].provider === 'veo' ? 'Veo (your Gemini connection)' : 'Pollo';
      try { return Object.assign(codeMotion({ brand, motion, duration_s, aspect, attempts: pAttempts, reason: 'your ' + (pAttempts[0].provider === 'veo' ? 'Gemini connection' : 'Pollo key') + ' did not start a video (' + pAttempts[0].error + ')' }), { provider_error: who + ': ' + pAttempts[0].error }); } catch (_) { /* fall through */ }
    }
    // Best rung's exact request shape — honour the caller's first preference.
    const first = (preferProviders && preferProviders[0]) || 'veo';
    const shape = { higgsfield: higgsfieldRequest, openmontage: openMontageRequest, sora: soraRequest, runway: runwayRequest, veo: veoRequest }[first] || veoRequest;
    // The keyless rung: a real, code-rendered creative instead of a stub. The
    // request a provider WOULD receive stays on the answer for the operator.
    try {
      return codeMotion({ brand, motion, duration_s, aspect, wouldRequest: shape(opts) });
    } catch (e) {
      return Object.assign(_notConnected(shape(opts)), { audio, motion_error: String((e && e.message) || e).slice(0, 160) });
    }
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

  const attempts = pAttempts.slice();
  for (const rung of rungs) {
    if (!rung.hasKey) { attempts.push({ provider: rung.name, skipped: 'no key' }); continue; }
    if (opts.deadline - Date.now() < 2000) { attempts.push({ provider: rung.name, skipped: 'call budget exhausted' }); continue; }
    console.log('[video] Trying ' + rung.name + ' (tier=' + tier + ')');
    try {
      const out = await rung.run(opts);
      // A job that says "completed" with no video is not a video: it used to
      // be returned as the success, and the cascade stopped on an empty result.
      if (out && out.ok && out.status === 'completed' && !out.video_url) {
        attempts.push({ provider: rung.name, error: 'completed without a video url' });
        console.warn('[video] ' + rung.name + ' completed with no video url — demoting');
        continue;
      }
      if (out && out.ok) return { ...out, tier, attempts };
      attempts.push({ provider: rung.name, error: (out && out.error) || 'unknown failure' });
      console.warn('[video] ' + rung.name + ' failed: ' + ((out && out.error) || 'unknown') + ' — demoting');
    } catch (e) {
      attempts.push({ provider: rung.name, error: String(e.message || e).substring(0, 200) });
      console.warn('[video] ' + rung.name + ' exception — demoting: ' + String(e.message || e).substring(0, 200));
    }
  }
  const why = attempts.map((a) => a.provider + ': ' + (a.skipped || a.error)).join('; ');
  // Every configured provider failed: the code-rendered creative still ships,
  // and the failure is said beside it, never hidden.
  try {
    return Object.assign(codeMotion({ brand, motion, duration_s, aspect, attempts, reason: 'every configured video provider failed (' + why + ')' }),
      { tier, provider_error: 'All video providers failed: ' + why });
  } catch (_) {
    return { ok: false, error: 'All video providers failed: ' + why, attempts, tier };
  }
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
    case 'pollo': return statusPollo(id);
    case 'code-motion':
      return { ok: true, provider: 'code-motion', job_id: id, status: 'rendered', video_url: null, mp4: null, note: 'A code-rendered motion creative is returned whole by generateVideo; there is no job to poll.' };
    default:
      return { ok: false, error: "Unknown video provider '" + provider + "'", available: ['pollo', 'veo', 'sora', 'higgsfield', 'openmontage', 'runway'] };
  }
}

function isConnected() { return anyKey(); }

module.exports = { generateVideo, getVideoStatus, isConnected, codeMotion, AUDIO_BEDS, audioBedFor, polloRequest, polloBalance, POLLO_MODEL };
