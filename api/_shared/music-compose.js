'use strict';
/*
 * music-compose.js - one track from a brief, at the quality the brief asks for
 * (2026-10-25).
 *
 * The operator, with a Gemini-made product video: "output needs to match this
 * quality as on Gemini". Gemini's own music model is Lyria, reached through the
 * Gemini API's Interactions endpoint (ai.google.dev/gemini-api/docs/music-
 * generation, read 2026-10-25): POST /v1beta/interactions { model, input } with
 * `x-goog-api-key`; the answer's `steps[]` of type `model_output` carry
 * `content[]` blocks, `type: "audio"` with base64 `data` (MP3 by default,
 * 44.1 kHz stereo, SynthID-watermarked) and `type: "text"` with the lyrics or
 * structure it sang. `lyria-3-clip-preview` makes a 30 s clip, `lyria-3.5` a
 * full song of a couple of minutes; the length is asked for in the prompt.
 * Input may be text and up to 10 images (a product photo here). Neither model
 * has a free tier ($0.04 a clip, $0.08 a song on the pricing page that day).
 *
 * Who pays, in order:
 *   1. the WORKSPACE'S OWN Gemini connection (a key, or Sign in with Google's
 *      access token + its project), recorded as the workspace's own answer, so
 *      no app credits are charged for it;
 *   2. the platform's GEMINI_API_KEY (charged as the route's credits), unless
 *      LYRIA_PLATFORM=off; a key on Google's free tier is refused, and the
 *      refusal is said, never hidden;
 *   3. ElevenLabs Music with ELEVENLABS_API_KEY, when free generation is off
 *      (the rule that already stood for this route);
 *   4. music-synth.js: a code-made instrumental SKETCH, labelled as one.
 * The bytes come back with what made them, the quality class (`studio` or
 * `sketch`), the lyrics the model sang and every refusal on the way.
 */

const INTERACTIONS = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const LYRIA_CLIP = process.env.LYRIA_CLIP_MODEL || 'lyria-3-clip-preview';
const LYRIA_SONG = process.env.LYRIA_SONG_MODEL || 'lyria-3.5';
const ELEVEN = 'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128';
const MAX_AUDIO = 4 * 1024 * 1024;        // a serverless response is capped at 4.5 MB
const MAX_IMAGE = 3 * 1024 * 1024;

function clean(s) { return String(s || '').replace(/[﻿​\s]/g, ''); }
function modelFor(seconds) { return Number(seconds) > 30 ? LYRIA_SONG : LYRIA_CLIP; }

/** The request Lyria is sent; auth is { apiKey } or { bearer, project }. */
function lyriaRequest({ prompt, seconds, image }, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && auth.apiKey) headers['x-goog-api-key'] = auth.apiKey;
  else if (auth && auth.bearer) {
    headers.Authorization = 'Bearer ' + auth.bearer;
    if (auth.project) headers['x-goog-user-project'] = auth.project;
  }
  const text = String(prompt || '').slice(0, 4000);
  const input = image ? [{ type: 'text', text }, { type: 'image', mime_type: image.mime, data: image.data }] : text;
  return { url: INTERACTIONS, headers, body: { model: modelFor(seconds), input } };
}

/** The audio and the sung text out of an Interactions answer. */
function readLyria(json) {
  const steps = (json && Array.isArray(json.steps)) ? json.steps : [];
  let audio = null, mime = 'audio/mpeg';
  const text = [];
  for (const st of steps) {
    if (!st || (st.type && st.type !== 'model_output')) continue;
    for (const c of (Array.isArray(st.content) ? st.content : [])) {
      if (c && c.type === 'audio' && c.data && !audio) { audio = Buffer.from(String(c.data), 'base64'); mime = c.mime_type || c.mimeType || mime; }
      else if (c && c.type === 'text' && c.text) text.push(String(c.text));
    }
  }
  return { audio, mime, text: text.join('\n').trim() };
}

function refusal(status, body) {
  let msg = String(body || '');
  try { const j = JSON.parse(body); msg = (j.error && (j.error.message || j.error.status)) || msg; } catch (_) { /* text */ }
  msg = msg.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (status === 429 || /free tier|quota|billing/i.test(msg)) return `Lyria needs a Gemini API key on a paid (billed) Google AI plan; it answered ${status}${msg ? ': ' + msg : ''}`;
  if (status === 400 && /safety|blocked|policy/i.test(msg)) return `Lyria declined this brief (${msg})`;
  return `Lyria answered ${status}${msg ? ': ' + msg : ''}`;
}

async function callLyria(spec, auth, { fetchImpl, timeoutMs } = {}) {
  const rq = lyriaRequest(spec, auth);
  const f = fetchImpl || fetch;
  let r;
  try {
    r = await f(rq.url, { method: 'POST', headers: rq.headers, body: JSON.stringify(rq.body), signal: AbortSignal.timeout(timeoutMs || 100000) });
  } catch (e) {
    return { ok: false, error: /timeout|abort/i.test(String(e && e.name)) ? 'Lyria did not finish in time' : 'Lyria could not be reached: ' + String(e && e.message || e).slice(0, 120) };
  }
  const raw = await r.text();
  if (!r.ok) return { ok: false, status: r.status, error: refusal(r.status, raw) };
  let json = null; try { json = JSON.parse(raw); } catch (_) { return { ok: false, error: 'Lyria answered with something that was not JSON' }; }
  const out = readLyria(json);
  if (!out.audio || out.audio.length < 2000) return { ok: false, error: 'Lyria answered without audio' + (out.text ? ': ' + out.text.slice(0, 160) : '') };
  if (out.audio.length > MAX_AUDIO) return { ok: false, error: 'Lyria made a track too large to send back here (' + (out.audio.length / 1e6).toFixed(1) + ' MB); ask for a shorter one' };
  return { ok: true, audio: out.audio, mime: out.mime, sung: out.text, model: rq.body.model };
}

async function callEleven(spec, key, { fetchImpl } = {}) {
  const f = fetchImpl || fetch;
  const lengthMs = Math.min(120000, Math.max(3000, Math.round(Number(spec.seconds) || 30) * 1000));
  const r = await f(ELEVEN, {
    method: 'POST',
    headers: { Accept: 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': key },
    body: JSON.stringify({ prompt: String(spec.prompt).slice(0, 4100), music_length_ms: lengthMs, model_id: process.env.ELEVENLABS_MUSIC_MODEL || 'music_v1', force_instrumental: spec.instrumental !== false }),
  });
  if (!r.ok) return { ok: false, status: r.status, error: `The music service answered ${r.status} and composed nothing. ${(await r.text()).slice(0, 300)}`.trim() };
  const buf = Buffer.from(await r.arrayBuffer());
  return { ok: true, audio: buf, mime: 'audio/mpeg', model: 'elevenlabs', songId: r.headers && r.headers.get && r.headers.get('song-id') };
}

/** A product photo as Lyria's image input; only a public address, bounded. */
async function imageFor(url, { fetchImpl } = {}) {
  if (!/^https:\/\/[^\s"'<>]+$/i.test(String(url || ''))) return null;
  try {
    await require('./brand-workspace-core.js').assertPublicUrl(url);
    const r = await (fetchImpl || fetch)(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    const type = String(r.headers.get('content-type') || '').split(';')[0];
    if (!r.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_IMAGE) return null;
    return { mime: type, data: buf.toString('base64') };
  } catch (_) { return null; }
}

/** The workspace's own Gemini credential for this request, else null. */
async function ownGemini() {
  try {
    const ov = await require('./workspace-connections-core.js').llmOverridesForCurrentRequest();
    const k = ov && ov.keys;
    if (k && k.gemini) return { apiKey: String(k.gemini) };
    if (k && k.gemini_oauth && k.gemini_oauth.access_token) return { bearer: k.gemini_oauth.access_token, project: k.gemini_oauth.project || '' };
  } catch (_) { /* no workspace */ }
  return null;
}

function note(kind, info) {
  try { require('./request-scope.js').noteLlm(kind, info); } catch (_) { /* no scope */ }
}

/**
 * spec: { prompt, seconds, instrumental, image_url }
 * opts: { freeGeneration, fetchImpl, own (override for tests) }
 * -> { ok, audio, mime, provider, model, quality, sung, refusals[], message }
 */
async function compose(spec, opts = {}) {
  const prompt = String(spec.prompt || '').trim().slice(0, 4100);
  if (!prompt) return { ok: false, status: 400, error: 'prompt_required', message: 'Describe the track first.' };
  const seconds = Math.round(Number(spec.seconds) || 30);
  const refusals = [];
  const image = spec.image_url ? await imageFor(spec.image_url, opts) : null;
  const lyriaSpec = { prompt, seconds, image };

  const own = opts.own !== undefined ? opts.own : await ownGemini();
  if (own) {
    const r = await callLyria(lyriaSpec, own, opts);
    if (r.ok) {
      note('ok', { own: true, kind: 'audio', provider: 'gemini', model: r.model });
      return { ok: true, audio: r.audio, mime: r.mime, provider: 'lyria', model: r.model, quality: 'studio', own: true, sung: r.sung, refusals, image: !!image };
    }
    refusals.push('Your Gemini connection: ' + r.error);
  }
  const platformKey = clean(process.env.GEMINI_API_KEY);
  if (platformKey && String(process.env.LYRIA_PLATFORM || '').toLowerCase() !== 'off') {
    const r = await callLyria(lyriaSpec, { apiKey: platformKey }, opts);
    if (r.ok) {
      note('ok', { own: false, kind: 'audio', provider: 'gemini', model: r.model });
      return { ok: true, audio: r.audio, mime: r.mime, provider: 'lyria', model: r.model, quality: 'studio', own: false, sung: r.sung, refusals, image: !!image };
    }
    refusals.push('The platform\'s Gemini key: ' + r.error);
  }
  const eleven = clean(process.env.ELEVENLABS_API_KEY);
  if (!opts.freeGeneration) {
    if (!eleven) {
      if (!own && !platformKey) return { ok: false, status: 501, error: 'music_unconfigured', message: 'Generating a track here needs a music model: connect your own Gemini key on AI Models (Lyria), or set GEMINI_API_KEY or ELEVENLABS_API_KEY on this deployment. Until then, use Open in Suno: the brief is copied for you.', refusals };
      return { ok: false, status: 502, error: 'music_provider_refused', message: refusals.join(' ') + ' Use Open in Suno meanwhile: the brief is copied for you.', refusals };
    }
    const r = await callEleven({ prompt, seconds, instrumental: spec.instrumental }, eleven, opts);
    if (r.ok) return { ok: true, audio: r.audio, mime: r.mime, provider: 'elevenlabs', model: r.model, songId: r.songId, quality: 'studio', refusals };
    return { ok: false, status: 502, error: 'music_provider_refused', message: r.error, refusals };
  }
  const out = require('../../music-synth.js').renderBytes(prompt, seconds || 30, { compact: true });
  return {
    ok: true, audio: Buffer.from(out.bytes), mime: 'audio/wav', provider: 'code-synth', model: 'music-synth', quality: 'sketch', refusals,
    message: 'This is a code-made instrumental sketch, not a produced track.' + (refusals.length ? ' ' + refusals.join(' ') : ' Connect your own Gemini key on AI Models to compose it with Lyria, Google\'s music model.'),
  };
}

module.exports = { compose, callLyria, readLyria, lyriaRequest, modelFor, refusal, INTERACTIONS, LYRIA_CLIP, LYRIA_SONG };
