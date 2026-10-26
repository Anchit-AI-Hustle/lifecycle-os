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
 * The chain (2026-10-25, ported from The Third Eye's Music Studio, which works
 * in production): every music model a key reaches is tried before anything is
 * made in code. The workspace's OWN keys first (recorded as its own answers, no
 * app credits), then the platform's:
 *   1. Lyria (Gemini): the workspace's Gemini connection, then GEMINI_API_KEY
 *      (unless LYRIA_PLATFORM=off). A free-tier key is refused; that is said.
 *   2. ElevenLabs Music (POST /v1/music, elevenlabs.io/docs/api-reference/music/
 *      compose, read 2026-10-25: model_id music_v1 | music_v2 | music_v2_5,
 *      music_length_ms 3000-600000, force_instrumental; the answer is the
 *      audio). A bad_prompt refusal carries a rewrite, tried once. Paid plan.
 *   3. Replicate: a sung song with lucataco/ace-step {tags, lyrics, duration
 *      <= 240}, an instrumental with meta/musicgen {prompt, duration,
 *      model_version stereo-large, output_format mp3} and stable-audio-open
 *      pinned behind it (inputs read off each model's schema page, 2026-10-25).
 *      A prediction is waited for (Prefer: wait) and polled inside the
 *      request; one still running is handed back as a job the page polls
 *      (`music-job`), never dropped.
 *   Before rungs 2-4 the song is PLANNED as The Third Eye plans it
 *   (third-eye-music/, its own agents, knowledge base and structures, 2026-10-26,
 *   the operator: "use the exact same system as being used in music studio in
 *   the the-third-eye repo"): Musicologist -> Beat-smith + Lyricist ->
 *   Conductor, each a JSON call on this app's model cascade with a
 *   deterministic fallback. ElevenLabs gets its elevenPrompt(plan), Replicate
 *   the plan's tags, lyrics and prompt. A brand's own lyrics are sung as written.
 *   4. Hugging Face MusicGen (HF_API_TOKEN), as The Third Eye calls it
 *      (api-inference.huggingface.co, x-wait-for-model), only for a model
 *      HF_MUSIC_MODEL names: no Inference Provider serves the default
 *      musicgen-small (read 2026-10-25), so with none named it is skipped.
 *   5. Only then, and only with free generation on, The Third Eye's code synth
 *      (renderWav) seeded by the request, the plan's prompt and the press's
 *      take: an instrumental SKETCH, labelled as one. Free generation is the
 *      keyless floor; it never skips a model a key reaches (it did: with it on,
 *      ElevenLabs was never called and every track was the sketch).
 * Every answer says what made it, the quality class (`studio` or `sketch`),
 * the lyrics the model sang and every refusal on the way.
 */

const INTERACTIONS = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const LYRIA_CLIP = process.env.LYRIA_CLIP_MODEL || 'lyria-3-clip-preview';
const LYRIA_SONG = process.env.LYRIA_SONG_MODEL || 'lyria-3.5';
const ELEVEN = 'https://api.elevenlabs.io/v1/music';
const ELEVEN_MODEL = process.env.ELEVENLABS_MUSIC_MODEL || 'music_v2_5';
const REPLICATE = 'https://api.replicate.com/v1';
const VOCAL_MODEL = process.env.MUSIC_SONG_MODEL || 'lucataco/ace-step';
const INSTR_MODEL = process.env.MUSIC_INSTRUMENTAL_MODEL || 'meta/musicgen';
const STABLE_AUDIO = 'stackadoc/stable-audio-open-1.0';
const STABLE_AUDIO_VERSION = '9aff84a639f96d0f7e6081cdea002d15133d0043727f849c40abdd166b7c75a8';
const MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const JOB_RE = /^(own|platform):([a-zA-Z0-9]{6,64})\.([a-f0-9]{32})$/;

// A job id names the person it was made for (Codex, #358): it is signed with
// the deployment's secret over its source, the prediction and the user, so
// another signed-in account cannot poll or download it.
function jobKey() {
  // Private secrets only: a constant in the source would let anyone sign.
  return String(process.env.SUPABASE_JWT_SECRET || process.env.CONNECTION_SECRET_KEY || process.env.CRON_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');
}
function jobSig(src, id, owner) {
  return require('crypto').createHmac('sha256', jobKey()).update(`music-job|${src}|${id}|${owner || ''}`).digest('hex').slice(0, 32);
}
function jobId(src, id, owner) { return jobKey() ? `${src}:${id}.${jobSig(src, id, owner)}` : null; }
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
  if (!r.ok) {
    // A Sign in with Google token made before Lyria's scope was asked for.
    const why = refusal(r.status, raw);
    if (r.status === 403 && /insufficient authentication scopes/i.test(raw) && auth && auth.bearer) return { ok: false, status: 403, error: why + '. Sign in with Google again on AI Models: the earlier sign-in did not grant the access Lyria needs' };
    return { ok: false, status: r.status, error: why };
  }
  let json = null; try { json = JSON.parse(raw); } catch (_) { return { ok: false, error: 'Lyria answered with something that was not JSON' }; }
  const out = readLyria(json);
  if (!out.audio || out.audio.length < 2000) return { ok: false, error: 'Lyria answered without audio' + (out.text ? ': ' + out.text.slice(0, 160) : '') };
  if (out.audio.length > MAX_AUDIO) return { ok: false, error: 'Lyria made a track too large to send back here (' + (out.audio.length / 1e6).toFixed(1) + ' MB); ask for a shorter one' };
  return { ok: true, audio: out.audio, mime: out.mime, sung: out.text, model: rq.body.model };
}

/** The brief, read back into the fields a tag-and-lyrics model takes. */
function partsOf(prompt) {
  const t = String(prompt || '');
  const genre = (t.match(/Create an original (.+?) track/i) || [])[1] || '';
  const mood = (t.match(/^Mood: ([^;.\n]+)/im) || [])[1] || '';
  const bpm = (t.match(/about (\d{2,3}) BPM/i) || [])[1] || '';
  const instruments = (t.match(/Instruments: ([^.\n]+)/i) || [])[1] || '';
  const lyr = t.split(/Sing exactly these lyrics, in this order, and no others:\s*\n/i)[1];
  const lyrics = lyr ? lyr.split(/\nDo not imitate/i)[0].trim() : '';
  const tags = [genre, mood, bpm && bpm + ' bpm', instruments].map((x) => String(x).trim()).filter(Boolean).join(', ').slice(0, 400);
  return { tags: tags || t.split('\n')[0].slice(0, 300), lyrics };
}

function elevenReason(status, body) {
  let msg = String(body || '');
  try { const d = JSON.parse(body).detail; msg = typeof d === 'string' ? d : (d && (d.message || d.status)) || msg; } catch (_) { /* text */ }
  msg = String(msg).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (status === 401) return `ElevenLabs refused the API key (401)${msg ? ': ' + msg : ''}`;
  if (/key id/i.test(msg)) return 'ElevenLabs needs the secret key (it starts with sk_), not the key id shown in its dashboard';
  if (status === 402 || /paid|plan|subscri|upgrade|quota|credits/i.test(msg)) return `ElevenLabs music needs a paid plan with music credits left (${status})${msg ? ': ' + msg : ''}`;
  return `ElevenLabs answered ${status}${msg ? ': ' + msg : ''}`;
}

async function callEleven(spec, key, { fetchImpl, deadline } = {}) {
  const f = fetchImpl || fetch;
  const lengthMs = Math.min(240000, Math.max(3000, Math.round(Number(spec.seconds) || 30) * 1000));
  let body = { prompt: String(spec.prompt).slice(0, 4100), music_length_ms: lengthMs, model_id: ELEVEN_MODEL, force_instrumental: spec.instrumental !== false };
  let format = 'mp3_44100_128', rewritten = false, formatFallback = false, retried = false;
  for (;;) {
    const left = (deadline || Date.now() + 100000) - Date.now();
    if (left < 5000) return { ok: false, error: 'ElevenLabs did not finish in time' };
    let r;
    try {
      r = await f(ELEVEN + '?output_format=' + format, {
        method: 'POST', headers: { Accept: 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': key },
        body: JSON.stringify(body), signal: AbortSignal.timeout(left - 2000),
      });
    } catch (e) {
      return { ok: false, error: /timeout|abort/i.test(String(e && e.name)) ? 'ElevenLabs did not finish in time' : 'ElevenLabs could not be reached' };
    }
    if (!r.ok) {
      const text = String(await r.text().catch(() => '')).slice(0, 2000).split(key).join('[key]');
      let better = null;
      try { const d = JSON.parse(text).detail; if (d && d.status === 'bad_prompt' && d.data && d.data.prompt_suggestion) better = String(d.data.prompt_suggestion); } catch (_) { /* text */ }
      if (better && !rewritten) { rewritten = true; body = Object.assign({}, body, { prompt: better.slice(0, 4100) }); continue; }
      if ((r.status === 400 || r.status === 422) && /output_format/i.test(text) && !formatFallback) { formatFallback = true; format = 'mp3_44100_64'; continue; }
      if ([429, 500, 502, 503, 504].includes(r.status) && !retried && left > 60000) { retried = true; await new Promise((ok) => setTimeout(ok, 3000)); continue; }
      return { ok: false, status: r.status, error: elevenReason(r.status, text) };
    }
    const ct = String((r.headers && r.headers.get && r.headers.get('content-type')) || '').split(';')[0];
    if (/json|^text\//.test(ct)) return { ok: false, error: `ElevenLabs answered with ${ct}, not audio` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return { ok: false, error: 'ElevenLabs answered without audio' };
    if (buf.length > MAX_AUDIO) return { ok: false, error: 'ElevenLabs made a track too large to send back here; ask for a shorter one' };
    return { ok: true, audio: buf, mime: ct.startsWith('audio/') ? ct : 'audio/mpeg', model: body.model_id, songId: r.headers && r.headers.get && r.headers.get('song-id') };
  }
}

/* ── Replicate ─────────────────────────────────────────────────────────── */

async function rq(token, pathname, init, f, deadline) {
  // Every request is bounded by what is left of the composition's deadline, so
  // a stalled call fails over (or hands back its job) instead of hanging past it.
  const left = Math.max(1000, (deadline || Date.now() + 30000) - Date.now() - 2000);
  let r;
  try {
    r = await f(REPLICATE + pathname, Object.assign({}, init, {
      headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, (init && init.headers) || {}),
      signal: AbortSignal.timeout(left),
    }));
  } catch (e) {
    const err = new Error(/timeout|abort/i.test(String(e && e.name)) ? 'Replicate did not answer in time' : 'Replicate could not be reached');
    err.status = 0; throw err;
  }
  const text = await r.text().catch(() => '');
  if (!r.ok) {
    let msg = text; try { const j = JSON.parse(text); msg = j.detail || j.title || text; } catch (_) { /* text */ }
    const e = new Error(`Replicate answered ${r.status}${msg ? ': ' + String(msg).replace(/\s+/g, ' ').slice(0, 200) : ''}`); e.status = r.status; throw e;
  }
  try { return JSON.parse(text); } catch (_) { throw new Error('Replicate answered with something that was not JSON'); }
}

async function createPrediction(token, model, input, { fetchImpl, version, waitS, deadline } = {}) {
  if (!MODEL_RE.test(model)) throw new Error('Invalid model slug');
  const f = fetchImpl || fetch;
  const prefer = waitS ? { Prefer: 'wait=' + Math.max(1, Math.min(60, waitS)) } : {};
  if (version) return rq(token, '/predictions', { method: 'POST', headers: prefer, body: JSON.stringify({ version, input }) }, f, deadline);
  const [owner, name] = model.split('/');
  return rq(token, `/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/predictions`, { method: 'POST', headers: prefer, body: JSON.stringify({ input }) }, f, deadline);
}

function getPrediction(token, id, { fetchImpl, deadline } = {}) {
  return rq(token, '/predictions/' + encodeURIComponent(id), { method: 'GET' }, fetchImpl || fetch, deadline);
}

/** The audio address a finished prediction names: a string, the first of a list, or an object's audio field. */
function outputUrl(out) {
  const pick = (v) => (typeof v === 'string' && /^https:\/\//.test(v) ? v : null);
  if (pick(out)) return out;
  if (Array.isArray(out)) for (const v of out) { const u = outputUrl(v); if (u) return u; }
  if (out && typeof out === 'object') for (const k of ['audio', 'audio_out', 'wav', 'mp3', 'output']) { const u = outputUrl(out[k]); if (u) return u; }
  return null;
}

/** Only Replicate's own delivery hosts are fetched for a prediction's audio. */
function deliveryHost(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && (x.hostname === 'replicate.delivery' || x.hostname.endsWith('.replicate.delivery')) ? x : null; } catch (_) { return null; }
}

async function fetchOutput(u, { fetchImpl, deadline } = {}) {
  const x = deliveryHost(u);
  if (!x) return { ok: false, error: 'Replicate named an audio address outside its own delivery host' };
  const r = await (fetchImpl || fetch)(`https://${x.hostname}${x.pathname}${x.search}`, { redirect: 'error', signal: AbortSignal.timeout(Math.max(1000, Math.min(30000, (deadline || Date.now() + 30000) - Date.now() - 2000))) }).catch(() => null);
  if (!r || !r.ok) return { ok: false, error: 'the finished track could not be read from Replicate' };
  const type = String((r.headers && r.headers.get && r.headers.get('content-type')) || '').split(';')[0] || (/\.wav$/i.test(x.pathname) ? 'audio/wav' : 'audio/mpeg');
  const buf = Buffer.from(await r.arrayBuffer());
  return { ok: true, audio: buf, mime: /^audio\//.test(type) ? type : (/\.wav$/i.test(x.pathname) ? 'audio/wav' : 'audio/mpeg'), url: u };
}

/**
 * One Replicate track: ACE-Step sings the lyrics; MusicGen (stable-audio-open
 * behind it) plays an instrumental. Waited for inside the request while the
 * deadline allows; a prediction still running comes back as `pending`.
 */
async function callReplicate(spec, token, { fetchImpl, deadline, src, owner } = {}) {
  const f = fetchImpl || fetch;
  const seconds = Math.round(Number(spec.seconds) || 30);
  // The Third Eye's plan when compose made one (tags + lyrics for ACE-Step,
  // the beat-smith's prompt for the instrumental models), else the brief read back.
  const parts = spec.plan ? { tags: spec.plan.tags, lyrics: spec.plan.lyrics } : partsOf(spec.prompt);
  const instr = String(spec.plan ? spec.plan.prompt : spec.prompt).slice(0, 1500);
  const sing = spec.instrumental === false && !!parts.lyrics;
  const tries = sing
    ? [[VOCAL_MODEL, { tags: parts.tags, lyrics: parts.lyrics, duration: Math.min(240, Math.max(5, seconds)) }]]
    : [];
  tries.push([INSTR_MODEL, { prompt: instr, duration: Math.min(60, Math.max(5, seconds)), model_version: process.env.MUSIC_INSTRUMENTAL_VERSION || 'stereo-large', output_format: 'mp3', normalization_strategy: 'loudness' }]);
  tries.push([STABLE_AUDIO, { prompt: instr, seconds_total: Math.min(47, Math.max(5, seconds)) }, STABLE_AUDIO_VERSION]);
  const errors = [];
  for (const [model, input, version] of tries) {
    let p;
    try {
      p = await createPrediction(token, model, input, { fetchImpl: f, version, deadline, waitS: Math.min(55, Math.floor(((deadline || Date.now() + 90000) - Date.now()) / 1000) - 20) });
    } catch (e) {
      errors.push(model + ': ' + (e && e.message || e));
      if (e && (e.status === 401 || e.status === 402 || e.status === 429)) break; // account-wide: the next model meets it too
      continue;
    }
    const meta = { model, sung: sing && model === VOCAL_MODEL ? parts.lyrics : '', vocal_fallback: sing && model !== VOCAL_MODEL };
    while (p && (p.status === 'starting' || p.status === 'processing')) {
      if ((deadline || 0) - Date.now() < 12000) {
        const j = jobId(src || 'platform', p.id, owner);
        if (!j) { errors.push(model + ': still rendering, and this deployment has no private secret to hand the track back as a job (set SUPABASE_JWT_SECRET)'); p = null; break; }
        return Object.assign({ ok: true, pending: true, job: j }, meta);
      }
      await new Promise((ok) => setTimeout(ok, 2500));
      const id = p.id;
      try { p = await getPrediction(token, id, { fetchImpl: f, deadline }); } catch (e) {
        // A poll that stalled: the prediction is still Replicate's to finish, so hand it back as a job.
        const j = jobId(src || 'platform', id, owner);
        if (j && e.status === 0) return Object.assign({ ok: true, pending: true, job: j }, meta);
        errors.push(model + ': ' + e.message); p = null;
      }
    }
    if (p && p.status === 'succeeded') {
      const url = outputUrl(p.output);
      if (!url) { errors.push(model + ': finished without an audio file'); continue; }
      const out = await fetchOutput(url, { fetchImpl: f, deadline });
      if (out.ok && out.audio.length <= MAX_AUDIO) return Object.assign({ ok: true }, out, meta);
      const j = out.ok ? jobId(src || 'platform', p.id, owner) : null;
      if (j) return Object.assign({ ok: true, pending: true, job: j }, meta); // too large to send inline: streamed by music-job
      if (out.ok) { errors.push(model + ': the track is too large to send back here and no job could be signed'); continue; }
      errors.push(model + ': ' + out.error); continue;
    }
    if (p) errors.push(model + ': ' + (p.error ? String(p.error).slice(0, 200) : 'the model ' + p.status));
  }
  return { ok: false, error: 'Replicate made no track (' + errors.join('; ') + ')' };
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

/** The workspace's own music keys (media connections): { elevenlabs, replicate }. */
async function ownMediaKeys() {
  try {
    const m = await require('./workspace-connections-core.js').mediaKeysForCurrentRequest();
    const k = (n) => (m && m[n] && m[n].api_key ? String(m[n].api_key) : '');
    return { elevenlabs: k('elevenlabs'), replicate: k('replicate') };
  } catch (_) { return {}; }
}

function note(kind, info) {
  try { require('./request-scope.js').noteLlm(kind, info); } catch (_) { /* no scope */ }
}

/**
 * spec: { prompt, seconds, instrumental, image_url }
 * opts: { freeGeneration, fetchImpl, own (override for tests) }
 * -> { ok, audio, mime, provider, model, quality, sung, refusals[], message }
 */
const SKETCH_RESERVE_MS = 4000;
// The Third Eye's SYNTH_CLIP_MAX: 60 s (22 kHz mono WAV, ~2.6 MB, under
// Vercel's 4.5 MB answer); a longer request is played as that clip.
const SKETCH_MAX_S = 60;
const TE = require('./third-eye-music');
async function compose(spec, opts = {}) {
  const prompt = String(spec.prompt || '').trim().slice(0, 4100);
  if (!prompt) return { ok: false, status: 400, error: 'prompt_required', message: 'Describe the track first.' };
  const seconds = Math.round(Number(spec.seconds) || 30);
  const refusals = [];
  const image = spec.image_url ? await imageFor(spec.image_url, opts) : null;
  const lyriaSpec = { prompt, seconds, image };

  // Every key the workspace connected is tried before any of the platform's
  // (Codex, #358): its own Gemini (Lyria), ElevenLabs and Replicate, then the
  // platform's in the same order. Its own keys cost it nothing.
  const own = opts.own !== undefined ? opts.own : await ownGemini();
  const platformKey = String(process.env.LYRIA_PLATFORM || '').toLowerCase() !== 'off' ? clean(process.env.GEMINI_API_KEY) : '';
  // With free generation on, the code-made sketch is the floor, and it takes
  // a second or two to render: the providers stop early enough for it to
  // finish inside the caller's deadline (it rendered past it before).
  // (`deadline` still decides whether a provider is worth starting at all.)
  const deadline = opts.deadline || (Date.now() + 100000);
  const callBy = deadline - (opts.freeGeneration ? SKETCH_RESERVE_MS : 0);
  const media = opts.ownKeys !== undefined ? (opts.ownKeys || {}) : await ownMediaKeys();
  const sources = [];
  const add = (src, kind, key) => { if (key) sources.push({ src, kind, key }); };
  add('own', 'lyria', own);
  add('own', 'elevenlabs', media.elevenlabs);
  add('own', 'replicate', media.replicate);
  add('platform', 'lyria', platformKey ? { apiKey: platformKey } : null);
  add('platform', 'elevenlabs', clean(process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY || process.env.XI_API_KEY));
  add('platform', 'replicate', clean(process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY));
  add('platform', 'huggingface', TE.hfToken());
  const LABEL = { lyria: 'Gemini', elevenlabs: 'ElevenLabs', replicate: 'Replicate', huggingface: 'Hugging Face' };
  // The Third Eye's Music Studio plans the song before any model it calls:
  // Musicologist -> Beat-smith + Lyricist -> Conductor (third-eye-music/). Lyria
  // takes the brand brief as written, so the plan is made only when a rung that
  // takes it is reached, once, inside the time that leaves for the model.
  const input = TE.inputFrom(prompt, { instrumental: spec.instrumental, seconds });
  let planned = opts.planned || null;
  const getPlan = async () => {
    if (!planned) planned = await TE.plan(input, { ms: Math.max(3000, Math.min(Number(process.env.MUSIC_PLAN_MS) || 30000, callBy - Date.now() - 45000)) });
    return planned;
  };
  const planInfo = () => planned && { by: planned.planned_by, prompt: planned.plan.prompt, tags: planned.plan.tags, lyrics: planned.plan.lyrics,
    genre: planned.brief && planned.brief.genre, bpm: planned.brief && planned.brief.bpm, key: planned.brief && planned.brief.key, moods: planned.brief && planned.brief.moods };
  for (const s of sources) {
    if (deadline - Date.now() < 15000) { refusals.push('There was no time left to try ' + LABEL[s.kind] + '.'); break; }
    const mine = s.src === 'own';
    if (s.kind === 'lyria') {
      // Lyria is bounded by the same deadline as the others (it waited 100 s).
      const r = await callLyria(lyriaSpec, s.key, Object.assign({}, opts, { timeoutMs: opts.timeoutMs || Math.max(1000, callBy - Date.now()) }));
      if (r.ok) {
        note('ok', { own: mine, kind: 'audio', provider: 'gemini', model: r.model });
        return { ok: true, audio: r.audio, mime: r.mime, provider: 'lyria', model: r.model, quality: 'studio', own: mine, sung: r.sung, refusals, image: !!image };
      }
      refusals.push((mine ? 'Your Gemini connection: ' : 'The platform\'s Gemini key: ') + r.error);
      continue;
    }
    const P = await getPlan();
    const pl = P.plan;
    let r;
    if (s.kind === 'elevenlabs') r = await callEleven({ prompt: TE.elevenPrompt({ prompt: pl.prompt, tags: pl.tags, lyrics: pl.lyrics, sing: P.sing }), seconds: TE.clipSecondsFor(seconds), instrumental: !P.sing }, s.key, { fetchImpl: opts.fetchImpl, deadline: callBy });
    else if (s.kind === 'replicate') r = await callReplicate({ prompt, plan: pl, seconds, instrumental: P.sing ? false : true }, s.key, { fetchImpl: opts.fetchImpl, deadline: callBy, src: s.src, owner: opts.owner });
    else {
      r = await TE.huggingFaceMusic(pl.prompt, seconds, { token: s.key, fetchImpl: opts.fetchImpl, deadline: callBy });
      if (r.ok && r.audio.length > MAX_AUDIO) r = { ok: false, error: 'Hugging Face made a track too large to send back here' };
    }
    if (r.ok) {
      note('ok', { own: mine, kind: 'audio', provider: s.kind, model: r.model });
      const said = r.vocal_fallback ? ' The singing model did not answer, so this one is instrumental.' : '';
      const sungNow = r.sung || (s.kind === 'elevenlabs' && P.sing ? pl.lyrics : '');
      const said2 = s.kind === 'huggingface' && P.sing ? ' This one is instrumental: the Hugging Face model does not sing.' : '';
      const base = { ok: true, provider: s.kind, model: r.model, quality: 'studio', own: mine, sung: sungNow, refusals, image: false, plan: planInfo(),
        message: (refusals.length ? refusals.join(' ') : '') + said + said2 };
      if (r.pending) return Object.assign(base, { pending: true, job: r.job });
      return Object.assign(base, { audio: r.audio, mime: r.mime, songId: r.songId });
    }
    refusals.push((mine ? 'Your ' : 'The platform\'s ') + LABEL[s.kind] + ' key: ' + r.error + '.');
  }
  if (!opts.freeGeneration) {
    if (!sources.length) return { ok: false, status: 501, error: 'music_unconfigured', message: 'Generating a track here needs a music model: connect your own Gemini key on AI Models (Lyria), or an ElevenLabs or Replicate key on Platform Connections, or set GEMINI_API_KEY, ELEVENLABS_API_KEY, REPLICATE_API_TOKEN on this deployment. Until then, use Open in Suno: the brief is copied for you.', refusals };
    return { ok: false, status: 502, error: 'music_provider_refused', message: refusals.join(' ') + ' Use Open in Suno meanwhile: the brief is copied for you.', refusals };
  }
  // The Third Eye's own code synth (third-eye-music/synth.js renderWav),
  // seeded by the request and the plan as there, plus this press's take.
  const P = await getPlan();
  const sketchSeconds = Math.max(5, Math.min(seconds || 30, SKETCH_MAX_S));
  const wav = TE.synthWav(P, input.description, sketchSeconds, String(spec.take || '').slice(0, 64));
  const b = P.brief || {};
  const summary = [b.genre, b.bpm && b.bpm + ' BPM', b.key, (b.moods || []).slice(0, 2).join(', ')].filter(Boolean).join(', ');
  return {
    ok: true, audio: wav, mime: 'audio/wav', provider: 'code-synth', model: 'third-eye-synth', quality: 'sketch', refusals,
    plan: planInfo(),
    message: 'This is a code-made instrumental sketch, not a produced track (' + summary + (P.planned_by === 'agents' ? ', planned by the song agents' : '') + '). Press Compose again for a different take.' + (refusals.length ? ' ' + refusals.join(' ') : ' No music model is connected: connect your own Gemini (Lyria), ElevenLabs or Replicate key to compose a produced track.'),
  };
}

/**
 * A Replicate job handed back by compose: its state, and once it has
 * finished, the track itself (read from Replicate's delivery host only).
 * The token is the one that started it: the workspace's own, or the platform's.
 */
async function job(id, opts = {}) {
  const m = JOB_RE.exec(String(id || ''));
  if (!m) return { ok: false, status: 400, error: 'job_invalid', message: 'That is not a music job this app started.' };
  if (!jobKey()) return { ok: false, status: 503, error: 'job_unsigned', message: 'This deployment has no private secret to check music jobs with.' };
  const want = Buffer.from(jobSig(m[1], m[2], opts.owner)), got = Buffer.from(m[3]);
  if (want.length !== got.length || !require('crypto').timingSafeEqual(want, got)) return { ok: false, status: 404, error: 'job_not_yours', message: 'That track was started by another account.' };
  let token = '';
  if (m[1] === 'own') token = (opts.ownKeys !== undefined ? (opts.ownKeys || {}) : await ownMediaKeys()).replicate || '';
  else token = clean(process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY);
  if (!token) return { ok: false, status: 409, error: 'job_key_gone', message: 'The Replicate key that started this track is no longer connected.' };
  let p;
  try { p = await getPrediction(token, m[2], { fetchImpl: opts.fetchImpl }); } catch (e) { return { ok: false, status: 502, error: 'job_unreadable', message: String(e && e.message || e) }; }
  if (p.status === 'starting' || p.status === 'processing') return { ok: true, pending: true, status: p.status };
  if (p.status !== 'succeeded') return { ok: false, status: 502, error: 'job_failed', message: 'Replicate did not finish the track: ' + String(p.error || p.status).slice(0, 200) };
  const url = outputUrl(p.output);
  if (!url || !deliveryHost(url)) return { ok: false, status: 502, error: 'job_no_audio', message: 'Replicate finished without an audio file.' };
  return { ok: true, done: true, url };
}

module.exports = { compose, job, jobId, callEleven, callReplicate, partsOf, outputUrl, deliveryHost, ELEVEN_MODEL, VOCAL_MODEL, INSTR_MODEL, callLyria, readLyria, lyriaRequest, modelFor, refusal, INTERACTIONS, LYRIA_CLIP, LYRIA_SONG };
