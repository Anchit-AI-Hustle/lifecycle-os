'use strict';
/*
 * The Third Eye's Music Studio, in Lifecycle OS (2026-10-26).
 *
 * The operator: "still that same output is only being generated - use the
 * exact same system as being used in music studio in the the-third-eye repo".
 *
 * The files beside this one are The Third Eye's own (frontend/src/lib/music:
 * agents, knowledge, structures, normalize, synth, types), types stripped and
 * nothing else changed. Its route (app/api/tools/music/route.ts) does:
 *   planSong(i): Musicologist -> (Beat-smith || Lyricist) -> Conductor, each a
 *     JSON model call grounded in the genre knowledge base, each with its own
 *     deterministic fallback, giving { prompt, tags, lyrics } and a brief
 *     (bpm, energy, key, moods);
 *   then ElevenLabs Music with elevenPrompt(plan), Replicate (ACE-Step sings
 *   tags + lyrics; MusicGen, then stable-audio-open, plays plan.prompt),
 *   Hugging Face MusicGen, and last its code synth renderWav seeded by
 *   `${description}|${prompt}`.
 * This file is the glue: a brand brief (brand-music.js) read back into The
 * Third Eye's MusicInput, the plan bounded by time, the two ElevenLabs helpers
 * (ported from its elevenlabs.ts, which uses a TypeScript-only constructor
 * form) and the Hugging Face call.
 *
 * LIFECYCLE differences, each for a rule of this app:
 * - Lyrics a brand brief carries are the brand's own words, sung as written
 *   (The Third Eye's "manual" lyrics mode); the lyricist writes only when the
 *   brief has none, as in The Third Eye.
 * - A reference artist the musicologist named never reaches a model prompt.
 * - The synth seed also carries the press's take, so a second press with every
 *   model down is a different track (the operator's "same output" report).
 * - knowledge.js matches genres by whole word (marked LIFECYCLE there): as a
 *   substring, "Warm acoustic ad bed" was planned as Drum and Bass.
 */

const { planSong, fallbackBrief, fallbackBeats, conductor, cleanLyrics } = require('./agents.js');
const { renderWav } = require('./synth.js');
const { track } = require('./llm-cascade.js');

const MAX_PROMPT = 4100;
const CLIP_MIN = 10, CLIP_MAX = 240;
const HF_MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** A brand brief (brand-music.js prompt) as The Third Eye's MusicInput. */
function inputFrom(prompt, { instrumental, seconds } = {}) {
  const t = String(prompt || '');
  const grab = (re) => ((t.match(re) || [])[1] || '').trim();
  const genre = grab(/Create an original (.+?) track/i);
  const brand = grab(/For the brand ([^\n]+?)\.\s*$/im);
  const product = grab(/It is for the product "([^"\n]+)"/i);
  const offer = grab(/^It promotes this offer: ([^\n]+?)\.?$/im);
  const purpose = grab(/^Purpose: ([^\n]+)$/im);
  const lyr = t.split(/Sing exactly these lyrics, in this order, and no others:\s*\n/i)[1];
  const lyrics = lyr ? cleanLyrics(lyr.split(/\nDo not imitate/i)[0]) : '';
  const language = grab(/lead vocal in ([A-Za-z ,]+?)\./i);
  let description;
  if (brand) {
    const head = (purpose.split(/[:.,;]/)[0].trim() || 'a track').replace(/^the brand's /i, 'the ');
    description = head.charAt(0).toUpperCase() + head.slice(1) + ' for ' + brand + (product ? ', for the product "' + product + '"' : '') + (offer ? ', promoting ' + offer : '');
  } else {
    description = t.split(/\n\s*\n/)[0];
  }
  description = description.replace(/\s+/g, ' ').trim().slice(0, 400);
  const vocals = instrumental === false;
  return {
    description,
    genre,
    mood: grab(/^Mood: ([^;.\n]+)/im),
    tempo: Number(grab(/about (\d{2,3}) BPM/i)) || undefined,
    instruments: grab(/Instruments: ([^.\n]+)/i),
    structure: grab(/^Structure: ([^.\n]+)/im),
    duration: Math.round(Number(seconds) || 30),
    vocals,
    vocalLanguage: language || undefined,
    lyricsMode: !vocals ? 'none' : (lyrics ? 'manual' : 'auto'),
    lyricsText: lyrics,
  };
}

/** The brief as it stands when every agent falls back (no model answered in time). */
function fallbackPlan(i) {
  const brief = fallbackBrief(i);
  const beats = fallbackBeats(i, brief);
  const lyrics = i.lyricsMode === 'manual' ? cleanLyrics(i.lyricsText || '') : '';
  return finish({ brief, plan: conductor(i, brief, beats, lyrics), planned_by: 'fallback', agents: [] }, i);
}

/** Every plan, from the agents or the fallbacks, leaves here the same way. */
function finish(out, i) {
  const artists = out.brief && out.brief.referenceArtists;
  out.plan = Object.assign({}, out.plan, { prompt: withoutArtists(out.plan.prompt, artists), tags: withoutArtists(out.plan.tags, artists) });
  out.sing = i.vocals !== false && !!String(out.plan.lyrics || '').trim();
  return out;
}

/** A reference artist's name never reaches a model (this app's rule). */
function withoutArtists(text, artists) {
  let s = String(text || '');
  for (const a of artists || []) {
    const n = String(a || '').trim();
    if (n.length < 3) continue;
    s = s.split(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join('');
  }
  return s.replace(/\(\s*\)/g, '').replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').trim();
}

/** planSong, bounded: past `ms` the deterministic plan is used. */
async function plan(i, { ms = 30000 } = {}) {
  let timer;
  const late = new Promise((ok) => { timer = setTimeout(() => ok(null), Math.max(0, ms)); });
  let out = null;
  const seen = { answered: [] };
  try { out = await Promise.race([track.run(seen, () => planSong(i)), late]); } catch (_) { out = null; }
  if (out) out = Object.assign({}, out, { planned_by: seen.answered.length ? 'agents' : 'fallback', agents: seen.answered.slice() });
  clearTimeout(timer);
  return out ? finish(out, i) : fallbackPlan(i);
}

/* From The Third Eye's elevenlabs.ts. */
function clipSecondsFor(sessionSeconds) {
  return Math.min(Math.max(Math.round(sessionSeconds) || 30, CLIP_MIN), CLIP_MAX);
}
function elevenPrompt(p) {
  const style = p.tags.trim() ? `Style: ${p.tags.trim()}` : '';
  const lyrics = p.sing && p.lyrics.trim() ? `Lyrics:\n${p.lyrics.trim()}` : '';
  const tail = [style, lyrics].filter(Boolean).join('\n\n');
  const room = MAX_PROMPT - tail.length - (tail ? 2 : 0);
  if (room < 200) return [p.prompt.trim().slice(0, 600), style, lyrics].filter(Boolean).join('\n\n').slice(0, MAX_PROMPT);
  return [p.prompt.trim().slice(0, room), tail].filter(Boolean).join('\n\n');
}

/* The Third Eye's tryHuggingFaceMusic, with its refusal said instead of dropped. */
function hfToken() {
  return String(process.env.HF_API_TOKEN || process.env.HUGGINGFACE_API_KEY || process.env.HUGGINGFACEHUB_API_TOKEN || '').replace(/[﻿​\s]/g, '');
}
async function huggingFaceMusic(promptText, seconds, { token, fetchImpl, deadline } = {}) {
  const t = token || hfToken();
  if (!t) return { ok: false, error: 'no Hugging Face token' };
  const model = process.env.HF_MUSIC_MODEL || 'facebook/musicgen-small';
  if (!HF_MODEL_RE.test(model)) return { ok: false, error: 'HF_MUSIC_MODEL is not a model id' };
  const duration = Math.min(Math.max(Math.round(seconds) || 15, 5), 30);
  const left = Math.max(1000, (deadline || Date.now() + 60000) - Date.now() - 2000);
  let r;
  try {
    r = await (fetchImpl || fetch)('https://api-inference.huggingface.co/models/' + model, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', Accept: 'audio/wav', 'x-wait-for-model': 'true' },
      body: JSON.stringify({ inputs: String(promptText).slice(0, 500), parameters: { duration } }),
      signal: AbortSignal.timeout(left),
    });
  } catch (e) {
    return { ok: false, error: /timeout|abort/i.test(String(e && e.name)) ? 'Hugging Face did not answer in time' : 'Hugging Face could not be reached' };
  }
  const ct = String((r.headers && r.headers.get && r.headers.get('content-type')) || '');
  if (!r.ok) {
    const body = String(await r.text().catch(() => '')).split(t).join('[key]').replace(/\s+/g, ' ').slice(0, 160);
    return { ok: false, status: r.status, error: 'Hugging Face answered ' + r.status + (body ? ': ' + body : '') };
  }
  if (ct.includes('application/json')) return { ok: false, error: 'Hugging Face answered with a status, not audio' };
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) return { ok: false, error: 'Hugging Face answered without audio' };
  return { ok: true, audio: buf, mime: ct.startsWith('audio/') ? ct.split(';')[0] : 'audio/wav', model: 'huggingface:' + model };
}

/** The Third Eye's code synth for this plan; the take keeps two presses apart. */
function synthWav(planned, description, seconds, take) {
  const b = planned.brief || {};
  const seed = `${description}|${planned.plan.prompt}` + (take ? '|' + take : '');
  return Buffer.from(renderWav({ bpm: b.bpm, seconds, energy: b.energy, key: b.key, moods: b.moods, seed }));
}

module.exports = { inputFrom, plan, fallbackPlan, withoutArtists, elevenPrompt, clipSecondsFor, huggingFaceMusic, hfToken, synthWav };
