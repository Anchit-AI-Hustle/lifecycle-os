// @ts-check
/**
 * The Third Eye's Music Studio, in Lifecycle OS (2026-10-26).
 *
 * The operator: "still that same output is only being generated - use the
 * exact same system as being used in music studio in the the-third-eye repo".
 * api/_shared/third-eye-music/ is The Third Eye's own lib/music (agents,
 * knowledge base, structures, normalize, synth), and music-compose.js now
 * runs its pipeline: the song is PLANNED by four agents (Musicologist ->
 * Beat-smith + Lyricist -> Conductor) before ElevenLabs, Replicate, Hugging
 * Face MusicGen and its code synth. Executed here: the shipped modules, with
 * llm.js swapped for a scripted model in require.cache and global.fetch
 * playing each music service; nothing reaches a network.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const LLM_PATH = path.join(ROOT, 'api', '_shared', 'llm.js');
const MC_PATH = path.join(ROOT, 'api', '_shared', 'music-compose.js');
const TE_DIR = path.join(ROOT, 'api', '_shared', 'third-eye-music');
const BM = require(path.join(ROOT, 'api', '_shared', 'brand-music.js'));

require(LLM_PATH);
const realLlm = require.cache[LLM_PATH].exports;
const prompts = [];
let script = () => { throw new Error('no model'); };
require.cache[LLM_PATH].exports = Object.assign(async (o) => { prompts.push(o); return script(o); }, realLlm);
const TE = require(TE_DIR);
const sha = (b) => crypto.createHash('sha256').update(Buffer.from(b)).digest('hex');
const fresh = () => { delete require.cache[MC_PATH]; return require(MC_PATH); };
const MUSIC_ENV = ['GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVEN_API_KEY', 'XI_API_KEY', 'REPLICATE_API_TOKEN', 'REPLICATE_API_KEY', 'HF_API_TOKEN', 'HUGGINGFACE_API_KEY', 'HUGGINGFACEHUB_API_TOKEN', 'HF_MUSIC_MODEL'];
async function withEnv(env, fn) {
  const saved = Object.fromEntries(MUSIC_ENV.concat(Object.keys(env)).map((k) => [k, process.env[k]]));
  for (const k of MUSIC_ENV) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
function fakeNet(answer) {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    const out = answer(u);
    if (!out) throw new Error('unrouted request: ' + u);
    return new Response(out.bytes || JSON.stringify(out.body), { status: out.status || 200, headers: { 'content-type': out.type || 'application/json' } });
  };
  return { calls, restore: () => { global.fetch = real; } };
}

/** A model that answers each agent as The Third Eye's agents expect. */
function agentsAnswer({ artist = 'Famous Singer', bpm = 96, prompt = 'warm fingerpicked groove' } = {}) {
  return (o) => {
    const sys = String(o.systemPrompt);
    if (/musicologist/i.test(sys)) return { text: JSON.stringify({ genre: 'Folk', subgenre: 'indie folk', region: 'Global', era: 'contemporary', bpm, key: 'G major', instruments: ['acoustic guitar', 'piano'], structure: 'Intro - Verse - Hook - Outro', moods: ['warm', 'inviting'], energy: 4, vocalStyle: 'warm female alto', referenceArtists: [artist], culturalContext: 'x', productionNotes: 'close-miked' }), provider: 'scripted', model: 'm' };
    if (/beat-maker/i.test(sys)) return { text: JSON.stringify({ modelPrompt: `${bpm} BPM ${prompt}, in the style of ${artist}, brushed drums`, styleTags: 'indie folk, warm, acoustic guitar', tempo: bpm, arrangement: 'intro, verse, hook' }), provider: 'scripted', model: 'm' };
    return { text: '[verse]\nmodel-written line\n[chorus]\nmodel hook', provider: 'scripted', model: 'm' };
  };
}

test.afterEach(() => { prompts.length = 0; script = () => { throw new Error('no model'); }; });

test('the ported files are The Third Eye\'s own, and every agent is there', async () => {
  for (const f of ['agents', 'knowledge', 'structures', 'normalize', 'synth', 'types']) {
    expect(fs.readFileSync(path.join(TE_DIR, f + '.js'), 'utf8')).toContain(`Ported from The Third Eye (frontend/src/lib/music/${f}.ts`);
  }
  const A = require(path.join(TE_DIR, 'agents.js'));
  for (const fn of ['musicologist', 'beatSmith', 'lyricist', 'conductor', 'planSong']) expect(typeof A[fn]).toBe('function');
  expect(require(path.join(TE_DIR, 'knowledge.js')).GENRE_KB.length).toBeGreaterThan(50);
  // Byte parity with The Third Eye's source, when that repository is checked out beside this one.
  const src = path.resolve(ROOT, '..', 'anchit-ai-hustle', 'the-third-eye', 'frontend', 'src', 'lib', 'music', 'synth.ts');
  if (fs.existsSync(src)) {
    const { stripTypeScriptTypes } = require('node:module');
    const strip = (s) => s.replace(/^'use strict';\n\/\/ Ported[^\n]*\n\/\/[^\n]*\n/, '').replace(/\nmodule\.exports = [^\n]*\n$/, '').replace(/^export /gm, '').replace(/\s+/g, ' ').trim();
    expect(strip(fs.readFileSync(path.join(TE_DIR, 'synth.js'), 'utf8'))).toBe(strip(stripTypeScriptTypes(fs.readFileSync(src, 'utf8'))));
  }
});

test('the agents plan the song from the brand brief: knowledge base grounding, JSON, the brand\'s own lyrics, no artist reaches a model', async () => {
  script = agentsAnswer();
  const brief = BM.plan({ brand: { name: 'Oak Bakers', tagline: 'Rye from the hearth', industry: 'bakery' }, purpose: 'product', product: { title: 'Seeded Rye Loaf' }, genre: 'folk', vocals: true, seconds: 30 });
  const i = TE.inputFrom(brief.prompt, { instrumental: false, seconds: 30 });
  expect(i).toMatchObject({ genre: brief.genre, vocals: true, lyricsMode: 'manual', tempo: brief.bpm });
  expect(i.description).toBe('The music for a short film about one product for Oak Bakers (bakery), for the product "Seeded Rye Loaf"');
  const P = await TE.plan(i, { ms: 10000 });
  expect(P.planned_by).toBe('agents');
  // Musicologist and Beat-smith answered; the Lyricist is not asked: the brand's lyrics are sung as written.
  expect(P.agents.sort()).toEqual(['music:beatsmith', 'music:musicologist']);
  expect(prompts.map((p) => p.stage).sort()).toEqual(['music:beatsmith', 'music:musicologist']);
  const mus = prompts.find((p) => p.stage === 'music:musicologist');
  expect(mus.responseFormat).toEqual({ type: 'json_object' });
  expect(mus.userMessage).toContain('KNOWLEDGE BASE:');
  expect(mus.userMessage).toContain('Folk');
  expect(mus.userMessage).toContain('Tempo hint: ' + brief.bpm + ' BPM');
  // The brand's tempo is the user's decision: kept over the model's.
  expect(P.brief.bpm).toBe(brief.bpm);
  expect(P.plan.lyrics).toBe(brief.lyrics.replace(/\[([A-Za-z -]+)\]/g, (_, t) => '[' + t.toLowerCase() + ']'));
  expect(P.plan.lyrics).not.toContain('model-written');
  expect(P.plan.prompt).not.toMatch(/Famous Singer/);
  expect(P.plan.tags).toMatch(new RegExp('^' + brief.bpm + ' bpm, '));
  expect(P.plan.tags).toMatch(/warm female alto, English, vocals/);
  expect(P.sing).toBe(true);
});

test('with no brand lyrics and vocals asked for, the Lyricist writes them, as in The Third Eye', async () => {
  script = agentsAnswer();
  const P = await TE.plan(TE.inputFrom('an upbeat summer song about lemonade', { instrumental: false, seconds: 30 }), { ms: 10000 });
  expect(P.agents).toContain('music:lyricist');
  expect(P.plan.lyrics).toContain('model hook');
});

test('a model that does not answer in time: the plan is The Third Eye\'s fallback, never a wait past the bound', async () => {
  script = () => new Promise(() => {});
  const t0 = Date.now();
  const P = await TE.plan(TE.inputFrom('Warm acoustic ad bed', { seconds: 10 }), { ms: 400 });
  expect(Date.now() - t0).toBeLessThan(2000);
  expect(P.planned_by).toBe('fallback');
  expect(P.brief.genre).toBe('Folk'); // the knowledge base, by whole word: "acoustic", never "ad bed" as Drum and Bass
  expect(P.plan.prompt).toMatch(/^Warm acoustic ad bed\. Folk at \d+ BPM/);
});

test('compose sends the plan: ElevenLabs gets elevenPrompt(plan), and the answer carries the plan', async () => {
  script = agentsAnswer({ prompt: 'sunlit kitchen groove' });
  const net = fakeNet((u) => (u.startsWith('https://api.elevenlabs.io/v1/music') ? { bytes: Buffer.alloc(12000, 1), type: 'audio/mpeg' } : null));
  try {
    await withEnv({ ELEVENLABS_API_KEY: 'sk_platform' }, async () => {
      const r = await fresh().compose({ prompt: 'A warm acoustic bed for a bakery', seconds: 20 }, { own: null, ownKeys: {}, freeGeneration: true });
      expect(r).toMatchObject({ ok: true, provider: 'elevenlabs', quality: 'studio' });
      const sent = net.calls[0].body;
      expect(sent.prompt).toBe(TE.elevenPrompt({ prompt: r.plan.prompt, tags: r.plan.tags, lyrics: '', sing: false }));
      expect(sent.prompt).toContain('sunlit kitchen groove');
      expect(sent.prompt).toMatch(/\n\nStyle: 96 bpm, mid-tempo, Folk, indie folk, G major, /);
      expect(sent.prompt).not.toMatch(/Famous Singer/);
      expect(sent).toMatchObject({ music_length_ms: 20000, force_instrumental: true });
      expect(r.plan.by).toBe('agents');
    });
  } finally { net.restore(); }
});

test('Hugging Face MusicGen is called as The Third Eye calls it; its refusal is said and the synth plays', async () => {
  let net = fakeNet((u) => (u === 'https://api-inference.huggingface.co/models/facebook/musicgen-small' ? { bytes: Buffer.from('RIFFwav-from-hf'), type: 'audio/wav' } : null));
  try {
    await withEnv({ HF_API_TOKEN: 'hf_test' }, async () => {
      const r = await fresh().compose({ prompt: 'Warm acoustic ad bed', seconds: 45 }, { own: null, ownKeys: {}, freeGeneration: true });
      expect(r).toMatchObject({ ok: true, provider: 'huggingface', model: 'huggingface:facebook/musicgen-small', quality: 'studio', own: false });
      expect(r.audio.toString()).toBe('RIFFwav-from-hf');
      const c = net.calls[0];
      expect(c.headers).toMatchObject({ Authorization: 'Bearer hf_test', Accept: 'audio/wav', 'x-wait-for-model': 'true' });
      expect(c.body).toEqual({ inputs: r.plan.prompt.slice(0, 500), parameters: { duration: 30 } });
    });
  } finally { net.restore(); }
  net = fakeNet((u) => (u.startsWith('https://api-inference.huggingface.co/') ? { status: 404, body: { error: 'Model not found' } } : null));
  try {
    await withEnv({ HF_API_TOKEN: 'hf_test' }, async () => {
      const r = await fresh().compose({ prompt: 'Warm acoustic ad bed', seconds: 8 }, { own: null, ownKeys: {}, freeGeneration: true });
      expect(r.provider).toBe('code-synth');
      expect(r.message).toMatch(/The platform's Hugging Face key: Hugging Face answered 404/);
      expect(r.message).not.toContain('hf_test');
    });
  } finally { net.restore(); }
});

test('the same output is never returned twice: another take, or another plan from the agents, is another track', async () => {
  const net = fakeNet(() => null);
  try {
    await withEnv({}, async () => {
      const MC = fresh();
      const o = { own: null, ownKeys: {}, freeGeneration: true };
      // No model at all: the take alone keeps two presses apart; one take is one track.
      const a = await MC.compose({ prompt: 'A product film for Oak Bakers', seconds: 6, take: '1' }, o);
      const a2 = await MC.compose({ prompt: 'A product film for Oak Bakers', seconds: 6, take: '1' }, o);
      const b = await MC.compose({ prompt: 'A product film for Oak Bakers', seconds: 6, take: '2' }, o);
      expect([a.provider, a.model, a.mime]).toEqual(['code-synth', 'third-eye-synth', 'audio/wav']);
      expect(sha(a.audio)).toBe(sha(a2.audio));
      expect(sha(a.audio)).not.toBe(sha(b.audio));
      // With the agents answering, a new plan is a new song even under the same take (The Third Eye's seed: description|prompt).
      script = agentsAnswer({ prompt: 'first idea', bpm: 90 });
      const c = await MC.compose({ prompt: 'A product film for Oak Bakers', seconds: 6, take: '1' }, o);
      script = agentsAnswer({ prompt: 'second idea', bpm: 124 });
      const d = await MC.compose({ prompt: 'A product film for Oak Bakers', seconds: 6, take: '1' }, o);
      expect(c.plan.by).toBe('agents');
      expect(sha(c.audio)).not.toBe(sha(d.audio));
      expect(c.message).toMatch(/\(Folk, 90 BPM, G major, warm, inviting, planned by the song agents\)/);
      // A WAV of the length asked for, capped at The Third Eye's 60 s clip.
      expect(a.audio.readUInt32LE(40)).toBe(6 * 22050 * 2);
      const long = await MC.compose({ prompt: 'x', seconds: 180 }, o);
      expect(long.audio.readUInt32LE(40)).toBe(60 * 22050 * 2);
      expect(net.calls).toEqual([]);
    });
  } finally { net.restore(); }
});
