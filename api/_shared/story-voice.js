/*
 * story-voice.js - a human voiceover for a Story video (2026-10-26).
 *
 * The operator: "audio missing in the video assets - ensure it is there too -
 * could be background music with human voiceovers", then, with the "Kill the
 * AI Tell" card: "ensure complete human touch".
 *
 * What is spoken: ONLY the ad's own words, scene by scene (the hook, each
 * product's name and price, the ad's lines, the closing call to action), read
 * back out of the validated story data. A [DATA REQUIRED ...] marker, a web
 * address or anything the story does not say is never spoken.
 *
 * How it sounds: a person, not an announcer. ElevenLabs with a lower stability
 * and some style (its documented voice_settings), each line sent with the
 * lines before and after it (previous_text / next_text) so the delivery flows
 * as one take; Gemini TTS with a speech_metadata style that asks for a voice
 * note recorded on a phone. The mix (code-video.js) adds room tone and ducks
 * the music under the voice.
 *
 * Who speaks, in order: the workspace's OWN ElevenLabs key, its OWN Gemini
 * connection (key or Sign in with Google), then the platform's ElevenLabs and
 * Gemini keys (only for a signed-in caller, metered as audio.tts by the route).
 * Each refusal is said. There is no keyless human voice: Pollinations' free
 * API carries no audio model (its /models listed one text model, 2026-10-26),
 * so with no key the video keeps its music and says why it has no voice.
 *
 * Endpoints, as documented:
 *   ElevenLabs  POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
 *               ?output_format=mp3_44100_128, header xi-api-key (the repo's own
 *               /tts route calls the same).
 *   Gemini TTS  POST https://generativelanguage.googleapis.com/v1beta/interactions
 *               { model, input: [{ type: 'user_input', content: [{ type: 'text',
 *               text, annotations: [{ type: 'speech_metadata', style }] }] }],
 *               response_format: { type: 'audio' },
 *               generation_config: { speech_config: [{ voice }] } }
 *               -> steps[].content[] { type: 'audio', data (base64 WAV, 24 kHz
 *               mono 16-bit) } (ai.google.dev/gemini-api/docs/speech-generation,
 *               read 2026-10-26).
 */
'use strict';

const ELEVEN_VOICE = 'EXAVITQu4vr4xnSDxMaL';
const ELEVEN_MODEL = 'eleven_multilingual_v2';
const GEMINI_TTS = 'gemini-3.8-flash-tts';
const GEMINI_VOICE = 'Kore';
const INTERACTIONS = 'https://generativelanguage.googleapis.com/v1beta/interactions';
// Lower stability = more natural variation; some style = a person's delivery.
const ELEVEN_SETTINGS = { stability: 0.38, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true };
const STYLE = 'Casual and warm, like a real person recording a quick voice note on their phone for a friend: an easy natural pace, small breaths, a slight smile in the voice. Never an announcer, never an advert voice.';
const MAX_LINE = 220;

/** The ad's own words, as lines to speak, with the scene each belongs to. */
function linesFor(data, cut) {
  if (!data || !data.cuts || !data.cuts.full) return [];
  const c = cut === 'short' && data.cuts.short ? data.cuts.short : data.cuts.full;
  const out = [];
  // A person says a thing once: a part already spoken (the end card often
  // repeats the hook) is not said again.
  const said = new Set();
  const key = (x) => String(x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const s of c.scenes) {
    let parts;
    if (s.kind === 'product') parts = [s.headline, s.price];
    else if (s.kind === 'end') parts = [s.headline, s.cta];
    else parts = [s.headline];
    parts = parts.filter((x) => x && !said.has(key(x)));
    parts.forEach((x) => said.add(key(x)));
    const text = speakable(parts.join(s.kind === 'end' ? '. ' : ', '));
    if (text) out.push({ start: s.start, seconds: s.seconds, kind: s.kind, text });
  }
  return out;
}

/** A line as a person would say it: no markers, no addresses, no dashes. */
function speakable(t) {
  let s = String(t || '');
  if (/\[DATA REQUIRED/i.test(s)) return '';
  s = s.replace(/https?:\/\/\S+|www\.\S+/gi, '').replace(/\s*[–—]\s*/g, ', ').replace(/[*_#<>{}\[\]|~^`]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (!/[.!?…]$/.test(s)) s += '.';
  return s.slice(0, MAX_LINE);
}

function elevenRequest(text, key, { voice, prev, next } = {}) {
  const body = { text, model_id: ELEVEN_MODEL, voice_settings: ELEVEN_SETTINGS };
  if (prev) body.previous_text = prev;
  if (next) body.next_text = next;
  return {
    url: 'https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voice || process.env.ELEVENLABS_VOICE_ID || ELEVEN_VOICE) + '?output_format=mp3_44100_128',
    headers: { Accept: 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': key },
    body,
  };
}

function geminiRequest(text, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && auth.apiKey) headers['x-goog-api-key'] = auth.apiKey;
  else if (auth && auth.bearer) { headers.Authorization = 'Bearer ' + auth.bearer; if (auth.project) headers['x-goog-user-project'] = auth.project; }
  return {
    url: INTERACTIONS, headers,
    body: {
      model: GEMINI_TTS,
      input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: STYLE }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: GEMINI_VOICE }] },
    },
  };
}

function reasonOf(label, status, raw) {
  let msg = String(raw || '');
  try { const j = JSON.parse(raw); const d = j.detail || j.error; msg = (typeof d === 'string' ? d : d && (d.message || d.status)) || msg; } catch (_) { /* text */ }
  msg = msg.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (status === 401) return label + ' refused the key (401)' + (msg ? ': ' + msg : '');
  if (status === 402 || status === 429 || /quota|credit|billing|free tier/i.test(msg)) return label + ' has no quota left on this key (' + status + ')' + (msg ? ': ' + msg : '');
  if (status === 403 && /insufficient authentication scopes/i.test(msg)) return label + ' refused the Google sign-in (403): sign in with Google again on AI Models';
  return label + ' answered ' + status + (msg ? ': ' + msg : '');
}

async function post(rq, f, ms, stop) {
  const t = AbortSignal.timeout(Math.max(1000, ms));
  const r = await f(rq.url, { method: 'POST', headers: rq.headers, body: JSON.stringify(rq.body), signal: stop ? AbortSignal.any([t, stop]) : t });
  return r;
}

/** One line from ElevenLabs: { audio, mime } or throws a sentence. */
async function speakEleven(text, key, o = {}) {
  const f = o.fetchImpl || fetch;
  let r;
  try { r = await post(elevenRequest(text, key, o), f, o.timeoutMs || 20000, o.signal); } catch (e) { throw new Error(o.signal && o.signal.aborted ? 'stopped: another line failed' : 'ElevenLabs did not answer in time'); }
  if (!r.ok) throw new Error(reasonOf('ElevenLabs', r.status, await r.text().catch(() => '')));
  const audio = Buffer.from(await r.arrayBuffer());
  if (audio.length < 200) throw new Error('ElevenLabs answered without audio');
  return { audio, mime: 'audio/mpeg' };
}

/** One line from Gemini TTS: { audio, mime } or throws a sentence. */
async function speakGemini(text, auth, o = {}) {
  const f = o.fetchImpl || fetch;
  let r;
  try { r = await post(geminiRequest(text, auth), f, o.timeoutMs || 20000, o.signal); } catch (e) { throw new Error(o.signal && o.signal.aborted ? 'stopped: another line failed' : 'Gemini TTS did not answer in time'); }
  const raw = await r.text().catch(() => '');
  if (!r.ok) throw new Error(reasonOf('Gemini TTS', r.status, raw));
  let json = null; try { json = JSON.parse(raw); } catch (_) { throw new Error('Gemini TTS answered with something that was not JSON'); }
  let hit = null;
  for (const st of (Array.isArray(json && json.steps) ? json.steps : [])) {
    for (const c of (Array.isArray(st && st.content) ? st.content : [])) if (c && c.type === 'audio' && c.data) hit = c;
  }
  if (!hit) throw new Error('Gemini TTS answered without audio');
  const audio = Buffer.from(String(hit.data), 'base64');
  if (audio.length < 200) throw new Error('Gemini TTS answered without audio');
  return { audio, mime: String(hit.mime_type || 'audio/wav') };
}

const LABEL = { elevenlabs: 'ElevenLabs', gemini: 'Gemini TTS' };

/**
 * Speak every line with the first source that speaks them all.
 * sources: [{ src: 'own'|'platform', kind: 'elevenlabs'|'gemini', key|auth }]
 * -> { ok, provider, model, own, clips: [{ start, seconds, text, audio, mime }], refusals }
 */
async function voiceTrack(lines, sources, o = {}) {
  const refusals = [];
  if (!lines.length) return { ok: false, refusals: ['The story has no words to speak.'] };
  const deadline = o.deadline || Date.now() + 30000;
  for (const s of sources) {
    const left = deadline - Date.now();
    if (left < 3000) { refusals.push('There was no time left to try ' + LABEL[s.kind] + '.'); break; }
    const who = (s.src === 'own' ? 'Your ' : 'The platform\'s ') + LABEL[s.kind] + ': ';
    // The lines go out together; the first one refused stops the rest, so a
    // provider is not left generating (and billing) lines that will be thrown
    // away (Codex, #366).
    const stop = new AbortController();
    try {
      const clips = await Promise.all(lines.map((l, i) => {
        const opt = { fetchImpl: o.fetchImpl, timeoutMs: left - 1000, signal: stop.signal, prev: i ? lines[i - 1].text : '', next: lines[i + 1] ? lines[i + 1].text : '' };
        return (s.kind === 'elevenlabs' ? speakEleven(l.text, s.key, opt) : speakGemini(l.text, s.auth, opt))
          .then((a) => Object.assign({}, l, a))
          .catch((e) => { stop.abort(); throw e; });
      }));
      return { ok: true, provider: s.kind, model: s.kind === 'elevenlabs' ? ELEVEN_MODEL : GEMINI_TTS, own: s.src === 'own', clips, refusals, chars: lines.reduce((n, l) => n + l.text.length, 0) };
    } catch (e) {
      refusals.push(who + String((e && e.message) || e) + '.');
    }
  }
  return { ok: false, refusals };
}

module.exports = { linesFor, speakable, elevenRequest, geminiRequest, speakEleven, speakGemini, voiceTrack, reasonOf, STYLE, ELEVEN_SETTINGS, ELEVEN_VOICE, ELEVEN_MODEL, GEMINI_TTS, GEMINI_VOICE, INTERACTIONS };
