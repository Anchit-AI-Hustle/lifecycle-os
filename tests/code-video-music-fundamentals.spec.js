// Every function the code-video and music-take work added or changed, tested
// branch by branch at its own level (2026-10-26, the operator: "go to the most
// basic fundamental level and test each and every single thing").
//
// Executed, never read: music-synth.js (plan, styles, the WAV it writes),
// music-compose.js (take, the sketch's reserved time, Lyria's scope refusal),
// smart-brain-plan's offer line (through buildCampaign), story-ad.js
// storyDataFrom / storyPage, code-video.js (bitrateFor, fileName, nextRung,
// fetchImage, handle, renderStoryVideo's options), music-client.js and the
// /brain MP4 button's refusals in Chromium.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// These renders check what the file holds, not how fast it was made: a CI
// runner shares its CPUs between workers, so they get room the 120 s function
// does not (the time limit has its own tests, with the real budget).
const CI_BUDGET = 240000;
const SY = require(path.join(ROOT, 'music-synth.js'));
const CV = require(path.join(ROOT, 'api', '_shared', 'code-video.js'));
const SA = require(path.join(ROOT, 'scripts', 'lib', 'story-ad.js'));
const sha = (b) => require('crypto').createHash('sha256').update(Buffer.from(b)).digest('hex');
const allow = async () => true;

/* ── music-synth.js: plan() ─────────────────────────────────────────────── */

test.describe('music-synth plan()', () => {
  test('the length: 5 to 60 seconds, rounded; anything that is not a positive number is 30', () => {
    const cases = [[undefined, 30], [null, 30], [0, 30], [-4, 30], ['abc', 30], [NaN, 30], [Infinity, 30],
      [1, 5], [4.4, 5], [5, 5], [7.6, 8], [8, 8], [15, 15], [59.4, 59], [60, 60], [61, 60], [9999, 60], ['12', 12]];
    for (const [given, want] of cases) expect(SY.plan('x', given).seconds, 'seconds ' + given).toBe(want);
    expect([SY.MIN_SECS, SY.MAX_SECS]).toEqual([5, 60]);
  });

  test('the seed: brief + length + take; no take and an empty take are one track; a take is held to 64 characters', () => {
    const a = SY.plan('Warm brief', 20), b = SY.plan('Warm brief', 20, { take: '' }), c = SY.plan('Warm brief', 20, {});
    expect(a.seed).toBe(b.seed); expect(a.seed).toBe(c.seed); expect(a.take).toBe('');
    expect(SY.plan('Warm brief', 20, { take: 'x' }).seed).not.toBe(a.seed);
    expect(SY.plan('Warm brief', 21).seed).not.toBe(a.seed);
    expect(SY.plan('Warm brief.', 20).seed).not.toBe(a.seed);
    const long = 'k'.repeat(64);
    expect(SY.plan('b', 20, { take: long + 'tail' }).seed).toBe(SY.plan('b', 20, { take: long }).seed);
    expect(SY.plan('b', 20, { take: long + 'tail' }).take).toBe(long);
    // The same arguments are the same plan, field for field.
    expect(SY.plan('Brief', 30, { take: 'q' })).toEqual(SY.plan('Brief', 30, { take: 'q' }));
    // Takes spread: 40 takes of one brief give 40 seeds.
    expect(new Set(Array.from({ length: 40 }, (_, i) => SY.plan('Brief', 30, { take: 't' + i }).seed)).size).toBe(40);
  });

  test('mode, energy and tempo come from the brief\'s words; a tempo is taken only between 50 and 200 BPM', () => {
    expect(SY.plan('a dark moody cinematic bed', 20).mode).toBe('minor');
    expect(SY.plan('a bright happy upbeat bed', 20).mode).toBe('major');
    expect(SY.plan('a driving energetic punchy bed', 20).energy).toBe('high');
    expect(SY.plan('a calm gentle soft bed', 20).energy).toBe('low');
    expect(SY.plan('a bed', 20).energy).toBe('mid');
    const st = SY.plan('a bed at 96 BPM', 20);
    expect([st.bpm, st.tempo_source]).toEqual([96, 'stated']);
    expect(SY.plan('120 beats per minute', 20).bpm).toBe(120);
    for (const [txt, base] of [['a bed at 300 BPM, energetic punchy driving', 118], ['at 49 bpm calm gentle soft', 78], ['a bed', 98]]) {
      const p = SY.plan(txt, 20, { take: 'z' });
      expect(p.tempo_source, txt).toBe('from energy');
      expect(Math.abs(p.bpm - base), txt + ' ' + p.bpm).toBeLessThanOrEqual(4);
    }
  });

  test('the melody: sixteen steps, each a scale degree 0-9 or a rest, rests only on the off-beats', () => {
    for (let i = 0; i < 50; i++) {
      const m = SY.plan('brief ' + i, 20, { take: String(i) }).motif;
      expect(m).toHaveLength(16);
      m.forEach((d, k) => {
        expect(Number.isInteger(d)).toBe(true);
        expect(d >= -1 && d <= 9).toBe(true);
        if (d === -1) expect(k % 2).toBe(1);
      });
    }
  });

  test('every style word, alone in a sentence, picks its band; a word that only CONTAINS one picks nothing', () => {
    for (const [style, def] of Object.entries(SY.STYLES)) {
      for (const w of def.words) {
        const p = SY.plan('A ' + w + ' track for the shop', 20, { take: 'w' });
        expect([w, p.style, p.style_from]).toEqual([w, style, 'brief']);
      }
    }
    for (const t of ['A popular brand', 'household names', 'a rocket launch', 'metallic sheen', 'clubhouse members', 'filmy evening', 'scored goals', 'soulful-ish']) {
      expect(SY.plan(t, 20, { take: 'w' }).style_from, t).toBe('take');
    }
  });

  test('the brief\'s own genre line is read first: an instrument list never outvotes it', () => {
    const brief = 'Create an original warm acoustic track, about 20 seconds long.\nInstruments: upright piano, light strings, film score feel.';
    expect(SY.plan(brief, 20).style).toBe('acoustic');
    // Every genre Brand Music can name has a band.
    const BM = require(path.join(ROOT, 'api', '_shared', 'brand-music.js'));
    const WANT = { 'modern pop': 'pop', 'warm acoustic': 'acoustic', 'cafe jazz': 'lofi', 'lo-fi hip-hop': 'lofi', 'hip-hop': 'lofi', house: 'electronic',
      afrobeats: 'pop', electronic: 'electronic', cinematic: 'cinematic', 'bollywood pop': 'pop', bhangra: 'pop', synthwave: 'electronic',
      'indie rock': 'rock', 'r&b': 'lofi', ambient: 'cinematic', 'latin pop': 'pop' };
    expect(Object.keys(BM.GENRES).sort()).toEqual(Object.keys(WANT).sort());
    for (const g of Object.keys(BM.GENRES)) {
      const p = BM.plan({ brand: { name: 'B', industry: 'x' }, purpose: 'anthem', genre: g, seconds: 20, vocals: false });
      expect([g, SY.plan(p.prompt, 20, { take: 'a' }).style]).toEqual([g, WANT[g]]);
    }
  });

  test('the summary says the band, where it came from, key, tempo, energy and length', () => {
    const p = SY.plan('A house track at 124 BPM', 12, { take: 'a' });
    expect(p.summary).toMatch(/^electronic \(from the brief\), [A-G]#? (major|minor), 124 BPM \(stated\), (low|mid|high) energy, 12 seconds$/);
    expect(SY.plan('A track for the shop', 12, { take: 'a' }).summary).toMatch(/^\w+ \(picked for this take\), /);
    expect(p.band).toBe(SY.STYLES.electronic.label);
  });
});

/* ── music-synth.js: the WAV it writes ──────────────────────────────────── */

function readWav(bytes) {
  const v = Buffer.from(bytes);
  return {
    riff: v.toString('latin1', 0, 4), size: v.readUInt32LE(4), wave: v.toString('latin1', 8, 12), fmt: v.toString('latin1', 12, 16),
    fmtLen: v.readUInt32LE(16), pcm: v.readUInt16LE(20), ch: v.readUInt16LE(22), rate: v.readUInt32LE(24), byteRate: v.readUInt32LE(28),
    align: v.readUInt16LE(32), bits: v.readUInt16LE(34), data: v.toString('latin1', 36, 40), dataLen: v.readUInt32LE(40), length: v.length,
    sample: (i) => v.readInt16LE(44 + 2 * i),
  };
}

test.describe('music-synth: the WAV', () => {
  test('compact: a valid 16-bit mono PCM WAV at 22.05 kHz whose header matches its bytes', () => {
    for (const secs of [5, 8, 15, 60]) {
      const w = readWav(SY.renderBytes('acoustic track', secs, { compact: true, take: 'h' }).bytes);
      expect([w.riff, w.wave, w.fmt, w.data]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
      expect([w.fmtLen, w.pcm, w.ch, w.rate, w.bits, w.align, w.byteRate]).toEqual([16, 1, 1, 22050, 16, 2, 44100]);
      expect(w.dataLen).toBe(secs * 22050 * 2);
      expect(w.size).toBe(36 + w.dataLen);
      expect(w.length).toBe(44 + w.dataLen);
      expect(w.length, 'a minute must fit one serverless answer').toBeLessThan(4.5 * 1024 * 1024);
    }
  });

  test('full: stereo at 44.1 kHz', () => {
    const w = readWav(SY.renderBytes('acoustic track', 5, { take: 'h' }).bytes);
    expect([w.ch, w.rate, w.align, w.byteRate, w.dataLen]).toEqual([2, 44100, 4, 176400, 5 * 44100 * 4]);
  });

  test('every band at every energy and at the shortest and a long length: loud, never a silent stretch, fades to nothing', () => {
    for (const style of Object.keys(SY.STYLES)) {
      for (const energy of ['calm gentle soft', '', 'energetic driving punchy']) {
        for (const secs of [5, 20]) {
          const brief = 'A ' + SY.STYLES[style].words[0] + ' track ' + energy;
          const out = SY.renderBytes(brief, secs, { compact: true, take: 'e' });
          expect(out.plan.style).toBe(style);
          const w = readWav(out.bytes), n = w.dataLen / 2;
          let peak = 0, run = 0, longest = 0;
          const from = Math.round(22050 * Math.min(1.5, secs / 6)), to = n - 22050 * 2;
          for (let i = 0; i < n; i++) {
            const s = w.sample(i); peak = Math.max(peak, Math.abs(s));
            if (i >= from && i < to) { if (s === 0) { run++; longest = Math.max(longest, run); } else run = 0; }
          }
          const tag = style + ' / ' + (energy || 'mid') + ' / ' + secs + ' s';
          expect(peak, tag + ' is quiet').toBeGreaterThan(25000);
          expect(peak, tag + ' clips').toBeLessThanOrEqual(32767);
          expect(longest, tag + ' has a silent stretch').toBeLessThan(22050 / 4);
          expect(Math.abs(w.sample(n - 1)), tag + ' does not fade out').toBeLessThan(200);
          expect(Math.abs(w.sample(0)), tag + ' does not fade in').toBeLessThan(200);
        }
      }
    }
  });

  test('the same brief and take is the same file; another take or another brief is another file', () => {
    const one = sha(SY.renderBytes('A pop jingle', 10, { compact: true, take: 'a' }).bytes);
    expect(sha(SY.renderBytes('A pop jingle', 10, { compact: true, take: 'a' }).bytes)).toBe(one);
    expect(sha(SY.renderBytes('A pop jingle', 10, { compact: true, take: 'b' }).bytes)).not.toBe(one);
    expect(sha(SY.renderBytes('A pop jingle!', 10, { compact: true, take: 'a' }).bytes)).not.toBe(one);
  });
});

/* ── music-compose.js ───────────────────────────────────────────────────── */

const fresh = () => { delete require.cache[require.resolve(path.join(ROOT, 'api', '_shared', 'music-compose.js'))]; return require(path.join(ROOT, 'api', '_shared', 'music-compose.js')); };
// No text model answers here: The Third Eye's song agents take their fallbacks
// (third-eye-music/), so the plan, and the sketch it seeds, is deterministic.
const LLM_PATH = path.join(ROOT, 'api', '_shared', 'llm.js');
require(LLM_PATH);
const realLlmExports = require.cache[LLM_PATH].exports;
require.cache[LLM_PATH].exports = Object.assign(async () => { throw new Error('no text model in this test'); }, realLlmExports);
// The stub stays in this file: a later spec in the same worker reads llm.js from require.cache.
test.afterAll(() => { require.cache[LLM_PATH].exports = realLlmExports; });
const NO_KEYS = ['HF_API_TOKEN', 'HUGGINGFACE_API_KEY', 'HUGGINGFACEHUB_API_TOKEN', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVEN_API_KEY', 'XI_API_KEY', 'REPLICATE_API_TOKEN', 'REPLICATE_API_KEY'];
async function noKeys(fn) {
  const saved = Object.fromEntries(NO_KEYS.map((k) => [k, process.env[k]]));
  for (const k of NO_KEYS) delete process.env[k];
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test.describe('music-compose', () => {
  test('the sketch takes the take: two takes are two tracks; the answer says what it is and to press again', async () => {
    await noKeys(async () => {
      const MC = fresh();
      const o = { own: null, ownKeys: {}, freeGeneration: true };
      const a = await MC.compose({ prompt: 'A pop jingle', seconds: 6, take: 'one' }, o);
      const b = await MC.compose({ prompt: 'A pop jingle', seconds: 6, take: 'two' }, o);
      const a2 = await MC.compose({ prompt: 'A pop jingle', seconds: 6, take: 'one' }, o);
      expect([a.provider, a.quality, a.mime]).toEqual(['code-synth', 'sketch', 'audio/wav']);
      expect(sha(a.audio)).toBe(sha(a2.audio));
      expect(sha(a.audio)).not.toBe(sha(b.audio));
      // The Third Eye's plan says what the sketch is: its genre and tempo.
      expect(a.plan).toMatchObject({ by: 'fallback', genre: expect.any(String), bpm: expect.any(Number) });
      expect(a.message).toContain('(' + a.plan.genre + ', ' + a.plan.bpm + ' BPM');
      expect(a.message).toMatch(/Press Compose again for a different take\./);
      expect(readWav(a.audio).dataLen).toBe(6 * 22050 * 2);
      // A take is held to 64 characters on the way in: 200 characters seed what the first 64 do.
      const TE = require(path.join(ROOT, 'api', '_shared', 'third-eye-music'));
      const c = await MC.compose({ prompt: 'A pop jingle', seconds: 6, take: 'y'.repeat(200) }, o);
      const P = TE.fallbackPlan(TE.inputFrom('A pop jingle', { seconds: 6 }));
      expect(sha(c.audio)).toBe(sha(TE.synthWav(P, 'A pop jingle', 6, 'y'.repeat(64))));
      expect(sha(c.audio)).not.toBe(sha(TE.synthWav(P, 'A pop jingle', 6, 'y'.repeat(65))));
    });
  });

  test('with free generation off nothing is sketched: the refusal is said', async () => {
    await noKeys(async () => {
      const r = await fresh().compose({ prompt: 'A pop jingle', seconds: 6, take: 'one' }, { own: null, ownKeys: {}, freeGeneration: false });
      expect([r.ok, r.status, r.error]).toEqual([false, 501, 'music_unconfigured']);
    });
  });

  test('a provider that never answers is cut early enough for the sketch to land inside the deadline; with free generation off it gets the whole deadline', async () => {
    test.setTimeout(90000);
    // A Lyria that answers only when aborted.
    const hang = async (url, init) => new Promise((_ok, fail) => { init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'TimeoutError'; fail(e); }); });
    await noKeys(async () => {
      const MC = fresh();
      let t0 = Date.now();
      const on = await MC.compose({ prompt: 'A pop jingle', seconds: 30 }, { own: { apiKey: 'own-gemini' }, ownKeys: {}, freeGeneration: true, fetchImpl: hang, deadline: Date.now() + 20000 });
      const tookOn = Date.now() - t0;
      expect(on.provider).toBe('code-synth');
      expect(on.refusals.join(' ')).toMatch(/Your Gemini connection: Lyria did not finish in time/);
      expect(tookOn, 'the sketch landed past the deadline').toBeLessThan(20000);
      expect(tookOn, 'Lyria was not given its time').toBeGreaterThan(14000);
      t0 = Date.now();
      const off = await MC.compose({ prompt: 'A pop jingle', seconds: 30 }, { own: { apiKey: 'own-gemini' }, ownKeys: {}, freeGeneration: false, fetchImpl: hang, deadline: Date.now() + 18000 });
      const tookOff = Date.now() - t0;
      expect([off.ok, off.status]).toEqual([false, 502]);
      expect(tookOff, 'Lyria ran past the deadline').toBeLessThan(18800);
      expect(tookOff, 'Lyria was cut short with nothing to make instead').toBeGreaterThan(17000);
    });
  });

  test('Lyria\'s scope refusal: a Sign in with Google token is told to sign in again; a key, or another 403, is not', async () => {
    const MC = fresh();
    const reply = (status, message) => async () => ({ ok: false, status, text: async () => JSON.stringify({ error: { code: status, message, status: 'PERMISSION_DENIED' } }) });
    const scope = 'Request had insufficient authentication scopes.';
    const bearer = { bearer: 'ya29.x', project: 'p' };
    expect((await MC.callLyria({ prompt: 'x', seconds: 10 }, bearer, { fetchImpl: reply(403, scope) })).error).toMatch(/Sign in with Google again on AI Models/);
    expect((await MC.callLyria({ prompt: 'x', seconds: 10 }, { apiKey: 'k' }, { fetchImpl: reply(403, scope) })).error).not.toMatch(/Sign in with Google/);
    expect((await MC.callLyria({ prompt: 'x', seconds: 10 }, bearer, { fetchImpl: reply(403, 'The caller does not have permission') })).error).not.toMatch(/Sign in with Google/);
    expect((await MC.callLyria({ prompt: 'x', seconds: 10 }, bearer, { fetchImpl: reply(401, scope) })).error).not.toMatch(/Sign in with Google again/);
    // And the sign-in asks for both scopes the Gemini OAuth guide's example uses.
    const S = require(path.join(ROOT, 'api', '_shared', 'ai-account-signin.js'));
    expect(S.SIGNIN.gemini.scope.split(' ').sort()).toEqual(['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/generative-language.retriever']);
  });
});

/* ── smart-brain-plan: the offer line of the music brief ────────────────── */

test('the music brief\'s offer: a fraction is a percentage, a whole number is one, a zero or a "0% off" line is no offer', async () => {
  test.setTimeout(120000);
  const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION'];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  const BR = { id: 'device:o', slug: 'o', name: 'Oak Bakers', industry: 'Bakery', website: 'https://www.oak.example', palette: { primary: '#832622', accent: '#f15a24', ink: '#2a1a12', surface: '#ffffff' }, regions: [{ code: 'IN', currency: 'INR', store_url: 'https://www.oak.example', home: true }] };
  const P = { sku: 'S1', title: 'Rye Loaf', handle: 'p1', image: 'https://cdn.oak.example/1.jpg', price: 120, url: 'https://www.oak.example/p1.html' };
  const slot = (offer) => ({ id: 'ob-' + Math.random().toString(36).slice(2, 7), date: '2026-10-28', market: 'IN', objective: 'reactivation', brand: BR, cohort: { name: 'At Risk', size: null, estimated: true }, channels: ['email'], confidence: 0.6, offer, heroProduct: P, supportingProducts: [] });
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const SB = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
    const music = async (offer) => (await SB.buildCampaign(slot(offer), smartConfig({}), { noLLM: true, withCreatives: false })).assets.music;
    const cases = [
      [{ pct: 15 }, 'sale', 'It promotes this offer: 15% off.'],
      [{ pct: 0.15 }, 'sale', 'It promotes this offer: 15% off.'],
      [{ pct: 0.155 }, 'sale', 'It promotes this offer: 16% off.'],
      [{ pct: 0.2, code: 'OAK20' }, 'sale', 'It promotes this offer: 20% off with code OAK20.'],
      [{ pct: 0 }, 'product', null],
      [{ pct: 0.004 }, 'product', null],
      [{ pct: -10 }, 'product', null],
      [{ pct: 'ten' }, 'product', null],
      [{ headline: '0% off' }, 'product', null],
      [{ headline: 'Save 00% today' }, 'product', null],
      [{ headline: '0.0% off' }, 'product', null],
      [{ headline: 'Flat 10% off' }, 'sale', 'It promotes this offer: Flat 10% off.'],
      [{ headline: '100% cashback' }, 'sale', 'It promotes this offer: 100% cashback.'],
      [{ headline: '0.5% back on every order' }, 'sale', 'It promotes this offer: 0.5% back on every order.'],
      [{ headline: 'Free delivery' }, 'sale', 'It promotes this offer: Free delivery.'],
      [{ headline: '0% off', pct: 0.1 }, 'sale', 'It promotes this offer: 10% off.'],
      [null, 'product', null],
    ];
    for (const [offer, purpose, line] of cases) {
      const m = await music(offer);
      expect([JSON.stringify(offer), m.purpose]).toEqual([JSON.stringify(offer), purpose]);
      if (line) expect(m.prompt, JSON.stringify(offer)).toContain(line);
      else expect(m.prompt, JSON.stringify(offer)).not.toMatch(/promotes this offer/);
      expect(m.prompt).not.toMatch(/(^|[^\d.])0+(\.0+)?\s*% off/);
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

/* ── story-ad.js: storyDataFrom / storyPage ─────────────────────────────── */

const page0 = (raw) => '<script>\n  var ALL = ' + JSON.stringify(raw) + ';\n</script>';
const S0 = (o) => Object.assign({ kind: 'hook', headline: 'Hi', seconds: 3 }, o);
const raw0 = (scenes, extra) => Object.assign({ cuts: { full: { scenes, total: 0 } }, pal: { primary: '#123456' }, fonts: { head: 'Inter', body: 'Inter' }, name: 'Oak' }, extra);

test.describe('story-ad storyDataFrom()', () => {
  test('what is not a story is null', () => {
    for (const bad of [undefined, null, '', 'hello', '<html></html>', 'var ALL = {"cuts":', 'var ALL = {bad json};\n',
      page0({}), page0({ cuts: {} }), page0({ cuts: { full: {} } }), page0({ cuts: { full: { scenes: [] } } }), page0({ cuts: { full: { scenes: 'x' } } })]) {
      expect(SA.storyDataFrom(bad), String(bad).slice(0, 40)).toBeNull();
    }
  });

  test('each scene field is held to its kind, length and form', () => {
    const d = SA.storyDataFrom(page0(raw0([
      S0({ kind: 'nonsense', headline: 'h'.repeat(500), price: 'p'.repeat(90), sub: 's'.repeat(300), cta: 'c'.repeat(90), image: 'https://cdn.example/a.jpg', move: 'push-in', sweep: 1 }),
      S0({ kind: 'product', price: '', image: 'javascript:alert(1)', move: 'spin', seconds: 'x' }),
      S0({ kind: 'end', image: 'data:image/png;base64,AAAA', seconds: -5 }),
      S0({ kind: 'line', image: 'https://cdn.example/a b.jpg' }),
      S0({ kind: 'line', image: 'https://cdn.example/"x.jpg' }),
      S0({ kind: 'line', image: 'ftp://cdn.example/x.jpg' }),
      S0({ kind: 'line', image: 'http://cdn.example/x.jpg', headline: 42 }),
    ])));
    const s = d.cuts.full.scenes;
    expect(s[0].kind).toBe('line');
    expect([s[0].headline.length, s[0].price.length, s[0].sub.length, s[0].cta.length]).toEqual([200, 40, 120, 40]);
    expect([s[0].image, s[0].move, s[0].sweep]).toEqual(['https://cdn.example/a.jpg', 'push-in', true]);
    expect([s[1].kind, s[1].price, s[1].image, s[1].move, s[1].sweep, s[1].seconds]).toEqual(['product', undefined, undefined, undefined, false, 0.5]);
    expect([s[2].kind, s[2].image, s[2].seconds]).toEqual(['end', undefined, 0.5]);
    expect([s[3].image, s[4].image, s[5].image]).toEqual([undefined, undefined, undefined]);
    expect([s[6].image, s[6].headline]).toEqual(['http://cdn.example/x.jpg', '']);
  });

  test('times are recomputed in order; twelve scenes at most; over 30 seconds is not a story', () => {
    const d = SA.storyDataFrom(page0(raw0([S0({ seconds: 2, start: 99 }), S0({ seconds: 3.5, start: 0 }), S0({ seconds: 1 })])));
    expect(d.cuts.full.scenes.map((x) => x.start)).toEqual([0, 2, 5.5]);
    expect(d.cuts.full.total).toBe(6.5);
    expect(SA.storyDataFrom(page0(raw0(Array.from({ length: 20 }, () => S0({ seconds: 1 }))))).cuts.full.scenes).toHaveLength(12);
    expect(SA.storyDataFrom(page0(raw0([S0({ seconds: 30 })]))).cuts.full.total).toBe(30);
    expect(SA.storyDataFrom(page0(raw0([S0({ seconds: 99 })]))).cuts.full.scenes[0].seconds).toBe(30);
    expect(SA.storyDataFrom(page0(raw0([S0({ seconds: 20 }), S0({ seconds: 11 })])))).toBeNull();
  });

  test('a short cut that is not a story is dropped; the full one stands', () => {
    const d = SA.storyDataFrom(page0(raw0([S0({})], { cuts: { full: { scenes: [S0({})] }, short: { scenes: [] } } })));
    expect(d.cuts.short).toBeNull();
    const e = SA.storyDataFrom(page0(raw0([S0({})], { cuts: { full: { scenes: [S0({})] }, short: { scenes: [S0({ seconds: 2 })] } } })));
    expect(e.cuts.short.total).toBe(2);
  });

  test('a colour is #rgb or #rrggbb, else the default; a font name carries no markup; the name is held to 80', () => {
    const pal = (p) => SA.storyDataFrom(page0(raw0([S0({})], { pal: p }))).pal;
    expect(pal({ primary: '#abc', ink: '#A1B2C3' })).toMatchObject({ primary: '#abc', ink: '#A1B2C3' });
    for (const bad of ['#abcd', '#12345', '#1234567', '#12345678', 'red', 'rgb(1,2,3)', '#zzzzzz', '', null, 7]) expect(pal({ primary: bad }).primary, String(bad)).toBe('#333366');
    const f = SA.storyDataFrom(page0(raw0([S0({})], { fonts: { head: 'Inter;}</style><script>x()</script>', body: undefined } }))).fonts;
    expect(f.head).not.toMatch(/[<>;{}()/]/);
    expect(f.body).toBe('system-ui, sans-serif');
    expect(SA.storyDataFrom(page0(raw0([S0({})], { name: 'n'.repeat(300) }))).name).toHaveLength(80);
  });

  test('storyPage: a headline that closes the script stays text, and the page round-trips to the same page', () => {
    const d = SA.storyDataFrom(page0(raw0([S0({ headline: '</script><script>alert(1)</script>' })])));
    const pg = SA.storyPage(d);
    const opens = (pg.match(/<script\b/gi) || []).length, closes = (pg.match(/<\/script>/gi) || []).length;
    expect(closes).toBe(opens);
    expect(pg).not.toContain('<script>alert(1)');
    expect(SA.storyDataFrom(pg).cuts.full.scenes[0].headline).toBe('</script><script>alert(1)</script>');
    expect(SA.storyPage(SA.storyDataFrom(pg))).toBe(pg);
  });
});

/* ── code-video.js: the small parts ─────────────────────────────────────── */

test.describe('code-video helpers', () => {
  test('bitrateFor: fits 4 MB at 90%, never above the ceiling, never below 400 kbit/s', () => {
    const fit = (s) => Math.floor((CV.MAX_BYTES_OUT * 8 * 0.9) / s);
    expect(CV.bitrateFor(1)).toBe(3000000);
    expect(CV.bitrateFor(1, 4000000)).toBe(4000000);
    expect(CV.bitrateFor(30, 4000000)).toBe(fit(30));
    expect(CV.bitrateFor(19, 2500000)).toBe(Math.min(2500000, fit(19)));
    expect(CV.bitrateFor(10000)).toBe(400000);
    expect(CV.bitrateFor(0)).toBe(3000000);
    for (const s of [5, 10, 15, 19, 30]) expect(CV.bitrateFor(s, 4000000) * s / 8).toBeLessThanOrEqual(CV.MAX_BYTES_OUT * 0.9);
  });

  test('fileName: the brand name as a slug, the length, the container', () => {
    expect(CV.fileName({ seconds: 19.4, container: 'mp4' }, 'Nik Bakers!!')).toBe('nik-bakers-story-19s.mp4');
    expect(CV.fileName({ seconds: 6, container: 'webm' }, '')).toBe('story-story-6s.webm');
    expect(CV.fileName({ seconds: 6, container: 'webm' }, '--Café / Noir--')).toBe('caf-noir-story-6s.webm');
    expect(CV.fileName({ seconds: 6, container: 'mp4' }, 'a'.repeat(200))).toBe('a'.repeat(60) + '-story-6s.mp4');
    expect(CV.fileName({ seconds: 6, container: 'mp4' }, '"; rm -rf /')).not.toMatch(/["\/; ]/);
  });

  test('nextRung: a smaller size is tried after slow, no encoder at that size, or a failure part-way; never after a story that did not start', () => {
    expect(CV.nextRung({ ok: false, slow: true })).toBe(true);
    expect(CV.nextRung({ ok: false, unsupported: true })).toBe(true);
    expect(CV.nextRung({ ok: false, failed: true })).toBe(true);
    expect(CV.nextRung({ ok: false, error: 'the story page did not start' })).toBe(false);
    expect(CV.nextRung({ ok: true })).toBe(false);
    expect(CV.nextRung(null)).toBe(false);
    expect(CV.SIZE_ORDER).toEqual(['1080p', '720p', '540p']);
    expect(CV.SIZES).toEqual({ '1080p': [1080, 1920], '720p': [720, 1280], '540p': [540, 960] });
  });
});

/* ── code-video.js: fetchImage ──────────────────────────────────────────── */

test.describe('code-video fetchImage()', () => {
  const img = (type, body, headers) => new Response(body || new Uint8Array(10), { status: 200, headers: Object.assign({ 'content-type': type }, headers || {}) });
  test('the image types it takes, and what it refuses', async () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'IMAGE/PNG', 'image/png; charset=binary']) {
      const r = await CV.fetchImage('https://i.example/a', async () => img(t), allow);
      expect(r.buf.length, t).toBe(10);
    }
    for (const t of ['image/svg+xml', 'text/html', 'application/octet-stream', 'image/x-icon', '']) {
      await expect(CV.fetchImage('https://i.example/a', async () => img(t), allow), t).rejects.toThrow(/not an image/);
    }
    for (const st of [404, 500, 403]) await expect(CV.fetchImage('https://i.example/a', async () => new Response('x', { status: st }), allow)).rejects.toThrow('HTTP ' + st);
    // A redirect with no Location is not followed: it is not an image.
    await expect(CV.fetchImage('https://i.example/a', async () => new Response('', { status: 302 }), allow)).rejects.toThrow('HTTP 302');
  });

  test('redirects: each hop is checked by the guard, a relative Location is resolved, the fifth hop is refused', async () => {
    const asked = [], checked = [];
    const hops = { 'https://i.example/a': '/b', 'https://i.example/b': 'https://j.example/c', 'https://j.example/c': '../d.png' };
    const f = async (u) => { asked.push(u); return hops[u] ? new Response('', { status: 301, headers: { location: hops[u] } }) : img('image/png'); };
    const r = await CV.fetchImage('https://i.example/a', f, async (u) => { checked.push(u); });
    expect(r.type).toBe('image/png');
    expect(asked).toEqual(['https://i.example/a', 'https://i.example/b', 'https://j.example/c', 'https://j.example/d.png']);
    expect(checked).toEqual(asked);
    // The guard refusing a hop stops it there: the refused address is never asked.
    const asked2 = [];
    await expect(CV.fetchImage('https://i.example/a', async (u) => { asked2.push(u); return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/x' } }); },
      async (u) => { if (/127\.0\.0\.1/.test(u)) throw new Error('not public'); })).rejects.toThrow('not public');
    expect(asked2).toEqual(['https://i.example/a']);
    const loop = async (u) => new Response('', { status: 302, headers: { location: u + 'x' } });
    await expect(CV.fetchImage('https://i.example/a', loop, allow)).rejects.toThrow('too many redirects');
    // The real guard: a private address is refused before any request.
    const calls = [];
    await expect(CV.fetchImage('http://127.0.0.1/x.png', async (u) => { calls.push(u); return img('image/png'); })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  test('size: exactly 8 MB is taken, one byte more is not; a declared size over the cap is refused unread', async () => {
    const MB8 = CV.MAX_IMAGE_BYTES;
    expect((await CV.fetchImage('https://i.example/a', async () => img('image/png', new Uint8Array(MB8)), allow)).buf.length).toBe(MB8);
    await expect(CV.fetchImage('https://i.example/a', async () => img('image/png', new Uint8Array(MB8 + 1)), allow)).rejects.toThrow(/over 8 MB/);
    let pulled = 0;
    const declared = async () => new Response(new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); } }), { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(MB8 + 1) } });
    await expect(CV.fetchImage('https://i.example/a', declared, allow)).rejects.toThrow(/over 8 MB/);
    expect(pulled, 'a declared oversize body was read').toBeLessThanOrEqual(1);
    // A body with no stream reader is still capped.
    const noStream = async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), body: null, arrayBuffer: async () => new ArrayBuffer(MB8 + 5) });
    await expect(CV.fetchImage('https://i.example/a', noStream, allow)).rejects.toThrow(/over 8 MB/);
    const small = async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), body: null, arrayBuffer: async () => new ArrayBuffer(7) });
    expect((await CV.fetchImage('https://i.example/a', small, allow)).buf.length).toBe(7);
  });

  test('the shared budget: refused unread when the declared size is over what is left, and counted down by what arrives', async () => {
    const budget = { left: 100 };
    await expect(CV.fetchImage('https://i.example/a', async () => img('image/png', new Uint8Array(10), { 'content-length': '101' }), allow, budget)).rejects.toThrow(/together/);
    expect(budget.left).toBe(100);
    await CV.fetchImage('https://i.example/a', async () => img('image/png', new Uint8Array(60)), allow, budget);
    expect(budget.left).toBe(40);
    await expect(CV.fetchImage('https://i.example/a', async () => img('image/png', new Uint8Array(60)), allow, budget)).rejects.toThrow(/together/);
    expect(CV.MAX_IMAGES_TOTAL).toBe(24 * 1024 * 1024);
  });
});

/* ── code-video.js: the route's doors ───────────────────────────────────── */

function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.removeHeader = (k) => { delete r.headers[k.toLowerCase()]; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = (b) => { r.body = b; return r; };
  return r;
}
const req = (o) => Object.assign({ method: 'POST', headers: { host: 'app.example', origin: 'https://app.example' }, socket: { remoteAddress: '10.0.0.' + (o.ip || 1) }, body: {} }, o);

test.describe('code-video handle()', () => {
  test.beforeEach(() => { const BR = require(path.join(ROOT, 'api', '_shared', 'brand-render.js')); if (BR.resetRateLimits) BR.resetRateLimits(); });

  test('only POST; no cache; no cross-site answer header', async () => {
    for (const m of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const res = fakeRes(); res.headers['access-control-allow-origin'] = '*';
      await CV.handle(req({ method: m }), res);
      expect([m, res.statusCode, res.body.error]).toEqual([m, 405, 'post_only']);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  test('another site, or no page at all, is refused; this site\'s page reaches the story check', async () => {
    for (const h of [{ host: 'app.example', origin: 'https://evil.example' }, { host: 'app.example' }, { host: 'app.example', referer: 'https://evil.example/x' }]) {
      const res = fakeRes();
      await CV.handle(req({ headers: h, ip: 2 }), res);
      expect([res.statusCode, res.body.error]).toEqual([403, 'not_this_site']);
    }
    const res = fakeRes();
    await CV.handle(req({ ip: 3, body: { html: '<p>not a story</p>' } }), res);
    expect([res.statusCode, res.body.error]).toEqual([400, 'not_a_story']);
    const res2 = fakeRes();
    await CV.handle(req({ ip: 3, body: { html: 12345 } }), res2);
    expect(res2.statusCode).toBe(400);
    const res3 = fakeRes();
    await CV.handle(req({ ip: 3, body: null }), res3);
    expect(res3.statusCode).toBe(400);
  });

  test('twelve renders per address per ten minutes, then a sentence; another address is not held by it', async () => {
    const codes = [];
    for (let i = 0; i < 13; i++) { const res = fakeRes(); await CV.handle(req({ ip: 9, body: { html: 'x' } }), res); codes.push(res.statusCode); }
    expect(codes.slice(0, 12).every((c) => c === 400)).toBe(true);
    expect(codes[12]).toBe(429);
    const res = fakeRes(); await CV.handle(req({ ip: 10, body: { html: 'x' } }), res);
    expect(res.statusCode).toBe(400);
  });
});

/* ── code-video.js: renderStoryVideo's options, rendered ────────────────── */

test('renderStoryVideo: story data instead of a page, the short cut, 30 fps; an unknown size starts at 720p', async () => {
  test.setTimeout(240000);
  const html = SA.renderStoryAd({ brand: { name: 'Oak Bakers' }, brandName: 'Oak Bakers', hook: 'Fresh this week', palette: { primary: '#832622', on_primary: '#ffffff', accent: '#ffffff', on_accent: '#2a1a12', surface: '#ffffff', ink: '#2a1a12' },
    products: [{ title: 'Rye Loaf', price_text: '₹120' }, { title: 'Seed Loaf', price_text: '₹140' }, { title: 'Sourdough', price_text: '₹160' }], lines: ['Baked at dawn', 'Delivered warm'], cta: 'Order now' });
  const d = SA.storyDataFrom(html);
  test.skip(!d.cuts.short, 'this story has no short cut');
  const r = await CV.renderStoryVideo({ budgetMs: CI_BUDGET, data: d, cut: 'short', fps: 30, size: '540p', fetchImpl: async () => { throw new Error('no network'); }, assertUrl: allow });
  expect(r.ok, r.message).toBe(true);
  expect([r.cut, r.fps, r.width, r.height]).toEqual(['short', 30, 540, 960]);
  expect(r.seconds).toBeCloseTo(d.cuts.short.total, 1);
  expect(r.frames).toBe(Math.round(d.cuts.short.total * 30));
  expect(r.images).toEqual({ used: 0, refused: [] });
  const r2 = await CV.renderStoryVideo({ html, cut: 'nonsense', fps: 17, size: 'bogus', budgetMs: CI_BUDGET, fetchImpl: async () => { throw new Error('no network'); }, assertUrl: allow });
  expect(r2.ok, r2.message).toBe(true);
  expect([r2.cut, r2.fps]).toEqual(['full', 24]);
  expect(r2.tried[0]).toMatch(/^720p/);
  expect(r2.seconds).toBeCloseTo(d.cuts.full.total, 1);
  const r3 = await CV.renderStoryVideo({ budgetMs: CI_BUDGET, html: '<p>no</p>' });
  expect(r3).toMatchObject({ ok: false, error: 'not_a_story' });
});

/* ── Chromium: music-client and the /brain button's refusals ────────────── */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
async function site(fn) {
  const server = http.createServer((q, s) => {
    const url = (q.url || '/').split('?')[0];
    if (url.startsWith('/api/')) { s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(JSON.stringify({ ok: true, workspaces: [] })); }
    const f = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('nf'); }
    s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn('http://127.0.0.1:' + server.address().port); } finally { await new Promise((r) => server.close(r)); }
}

test('music-client: every press sends a new take; a take the caller pins is kept; the caller\'s body is not changed', async ({ page }) => {
  await site(async (base) => {
    const sent = [];
    await page.route('**/api/brain?action=music-compose', async (r) => { sent.push(JSON.parse(r.request().postData() || '{}')); await r.fulfill({ status: 200, contentType: 'audio/wav', body: Buffer.from('RIFFxxxxWAVE'), headers: { 'X-Music-Provider': 'code-synth', 'X-Music-Quality': 'sketch' } }); });
    await page.goto(base + '/404.html');
    await page.addScriptTag({ url: base + '/music-client.js' });
    const out = await page.evaluate(async () => {
      const body = { prompt: 'A pop jingle', seconds: 8 };
      const a = await window.MusicClient.compose(body);
      await window.MusicClient.compose(body);
      await window.MusicClient.compose({ prompt: 'x', take: 'pinned' });
      await window.MusicClient.compose({ prompt: 'x', take: '' });
      await window.MusicClient.compose({ prompt: 'x', take: 0 });
      return { untouched: !('take' in body), quality: a.quality, provider: a.provider };
    });
    expect(out).toEqual({ untouched: true, quality: 'sketch', provider: 'code-synth' });
    expect(sent).toHaveLength(5);
    expect(sent[0].take).toMatch(/^[a-z0-9]{8,}$/);
    expect(sent[1].take).toMatch(/^[a-z0-9]{8,}$/);
    expect(sent[0].take).not.toBe(sent[1].take);
    expect(sent[2].take).toBe('pinned');
    expect(sent[3].take).toMatch(/^[a-z0-9]{8,}$/);
    expect(sent[4].take).toBe(0);
    expect(sent[0]).toMatchObject({ prompt: 'A pop jingle', seconds: 8 });
  });
});

test('/brain MP4 button: a refusal is said in the server\'s words, a network failure is said, and the button comes back', async ({ page }) => {
  test.setTimeout(120000);
  await site(async (base) => {
    let mode = 'refuse';
    await page.route('**/api/public-config?action=video-render', async (r) => {
      if (mode === 'refuse') return r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'rate_limited', message: 'Too many renders from this address. Try again in ten minutes.' }) });
      if (mode === 'html') return r.fulfill({ status: 200, contentType: 'text/html', body: '<p>proxy page</p>' });
      return r.abort();
    });
    await page.goto(base + '/smart-brain.html', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof renderAd === 'function' && typeof window.sbRenderMp4 === 'function', null, { timeout: 20000 });
    const html = SA.renderStoryAd({ brand: { name: 'Oak' }, brandName: 'Oak', hook: 'Hi', palette: { primary: '#832622' }, products: [{ title: 'Rye' }], lines: ['x'], cta: 'Order' });
    await page.evaluate((html) => {
      const host = document.createElement('div'); host.id = 'cv-host'; document.body.appendChild(host);
      host.innerHTML = renderAd({ platform: 'meta', creative_type: 'video', creative: { motion_html: '<p>x</p>', story_html: html, story_brief: { duration_s: 9 } } });
    }, html);
    const btn = page.locator('#cv-host [data-code-mp4]'), out = page.locator('#cv-host [data-code-mp4-out]');
    await btn.click();
    await expect(out).toHaveText('Too many renders from this address. Try again in ten minutes.');
    await expect(btn).toBeEnabled();
    mode = 'html';
    await btn.click();
    await expect(out).toHaveText(/The video could not be rendered \(HTTP 200\)\./);
    await expect(page.locator('#cv-host [data-code-mp4-out] video')).toHaveCount(0);
    mode = 'abort';
    await btn.click();
    await expect(out).toHaveText(/^The video could not be rendered: /);
    await expect(btn).toBeEnabled();
    // An ad with no story has no button.
    await page.evaluate(() => { document.getElementById('cv-host').innerHTML = renderAd({ platform: 'meta', creative_type: 'video', creative: { motion_html: '<p>x</p>' } }); });
    await expect(page.locator('#cv-host [data-code-mp4]')).toHaveCount(0);
  });
});
