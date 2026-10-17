/*
 * music-synth.js - a generated instrumental, made in the browser from a brief
 * (2026-10-17).
 *
 * The operator: every feature must work with NO API keys. /music's "Generate
 * here" needs ElevenLabs Music (ELEVENLABS_API_KEY); without it this file
 * renders a short instrumental bed with the Web Audio API alone: no service,
 * no key, no library, no network: every sample is computed in plain JavaScript.
 *
 * What it reads from the brief, and nothing else:
 *   - a tempo the brief STATES ("96 BPM"), else one from its energy;
 *   - mood words: minor-leaning words (calm, dark, cinematic, moody, premium,
 *     minimal ...) against major-leaning ones (upbeat, bright, playful, happy,
 *     confident ...) choose the scale;
 *   - energy words choose how dense the drums are (sparse, groove, driving);
 *   - the length is the page's own length field, held to 15-60 seconds.
 * Everything else (key, progression, arpeggio pattern) comes from a hash of
 * the brief, so the SAME brief always gives the SAME track, byte for byte.
 *
 * Why not an OfflineAudioContext node graph: measured 2026-10-17 in Chromium,
 * two renders of the SAME graph differed by one LSB on 62 to 200 samples, so
 * a graph cannot keep "same brief, same bytes". Computing the samples here
 * keeps it, needs no user gesture (iOS Safari) and plays nothing aloud. The
 * result is a 16-bit PCM stereo WAV whose RIFF header is written here; the
 * page plays it in an <audio> element. It is a generated instrumental bed, not
 * a composed song, and the page says so.
 *
 * window.MusicSynth = { plan(brief, seconds), render(brief, seconds) -> Promise<{blob, plan, sampleRate, seconds}>, wav([left, right]) }
 */
(function (root) {
  'use strict';

  var SAMPLE_RATE = 44100;
  var MIN_SECS = 15, MAX_SECS = 60;

  function hash(str) { // FNV-1a, 32 bit
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) { // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function count(text, words) {
    var n = 0;
    for (var i = 0; i < words.length; i++) if (new RegExp('\\b' + words[i], 'i').test(text)) n++;
    return n;
  }

  var MINOR_WORDS = ['calm', 'dark', 'cinematic', 'moody', 'mysterious', 'melanchol', 'sad', 'serious', 'tense', 'minimal', 'premium', 'night', 'brooding', 'emotional', 'underscore'];
  var MAJOR_WORDS = ['upbeat', 'bright', 'playful', 'happy', 'confident', 'cheer', 'joy', 'sunny', 'fun', 'friendly', 'uplifting', 'positive', 'festive', 'jingle'];
  var HIGH_WORDS = ['upbeat', 'energetic', 'energy', 'driving', 'hype', 'bold', 'punchy', 'fast', 'dance', 'party', 'hook', 'confident', 'playful', 'bright', 'sport'];
  var LOW_WORDS = ['calm', 'warm', 'gentle', 'minimal', 'ambient', 'soft', 'slow', 'relax', 'underscore', 'quiet', 'peaceful', 'chill', 'builds gently'];

  var SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  // Progressions as scale degrees (0-based), four bars each.
  var PROGS = {
    major: [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 3], [5, 3, 0, 4]],
    minor: [[0, 5, 2, 6], [0, 3, 4, 0], [0, 6, 5, 6], [0, 5, 3, 4]]
  };
  var KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function plan(brief, seconds) {
    var text = String(brief || '');
    var secs = Math.round(Number(seconds));
    if (!isFinite(secs) || secs <= 0) secs = 30;
    secs = Math.max(MIN_SECS, Math.min(MAX_SECS, secs));
    var seed = hash(text + '|' + secs);
    var r = rng(seed);
    var minorScore = count(text, MINOR_WORDS), majorScore = count(text, MAJOR_WORDS);
    var mode = minorScore > majorScore ? 'minor' : (majorScore > minorScore ? 'major' : (r() < 0.5 ? 'major' : 'minor'));
    var hi = count(text, HIGH_WORDS), lo = count(text, LOW_WORDS);
    var energy = hi > lo ? 'high' : (lo > hi ? 'low' : 'mid');
    var stated = text.match(/(\d{2,3})\s*(?:bpm|beats per minute)/i);
    var bpm = stated ? Number(stated[1]) : 0;
    var tempoSource = 'stated';
    if (!(bpm >= 50 && bpm <= 200)) {
      bpm = { low: 78, mid: 98, high: 118 }[energy] + Math.floor(r() * 9) - 4;
      tempoSource = 'from energy';
    }
    var rootPc = Math.floor(r() * 12);
    var prog = PROGS[mode][Math.floor(r() * PROGS[mode].length)];
    var arp = [];
    for (var i = 0; i < 8; i++) arp.push(Math.floor(r() * 3) + (r() < 0.25 ? 3 : 0));
    return {
      seconds: secs, seed: seed, mode: mode, energy: energy, bpm: bpm, tempo_source: tempoSource,
      key: KEY_NAMES[rootPc] + ' ' + mode, root_pc: rootPc, progression: prog, arpeggio: arp,
      summary: KEY_NAMES[rootPc] + ' ' + mode + ', ' + bpm + ' BPM (' + tempoSource + '), ' + energy + ' energy, ' + secs + ' seconds'
    };
  }

  function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function degree(p, deg, octave) {
    var sc = SCALES[p.mode];
    var o = Math.floor(deg / 7), d = ((deg % 7) + 7) % 7;
    return 12 * (octave + 1 + o) + p.root_pc + sc[d];
  }

  // ── The synthesiser: every sample computed here, in order, so the same plan
  //    is the same bytes on every run. (Measured 2026-10-17: two renders of
  //    one graph in Chromium's OfflineAudioContext differed by one LSB on 62
  //    to 200 samples, so a node graph cannot keep the promise "same brief,
  //    same track". Plain arithmetic needs no audio API, no user gesture
  //    (iOS Safari) and no library.)

  var TAU = Math.PI * 2;
  function wave(type, ph) { // ph in cycles
    var x = ph - Math.floor(ph);
    if (type === 'sine') return Math.sin(TAU * x);
    if (type === 'triangle') return x < 0.5 ? 4 * x - 1 : 3 - 4 * x;
    return x < 0.5 ? 1 : -1; // square
  }
  function gainAt(dt, peak, attack, decay) {
    if (dt < 0) return 0;
    if (dt < attack) return peak * (dt / attack);
    var x = (dt - attack) / decay;
    if (x >= 1) return 0;
    return peak * Math.pow(0.0001 / peak, x);
  }
  // One voice added into L/R: an oscillator (or noise), an envelope, an
  // optional one-pole filter, a fixed pan.
  function voice(L, R, o) {
    var start = Math.round(o.t * SAMPLE_RATE);
    var n = Math.round(o.dur * SAMPLE_RATE);
    var end = Math.min(L.length, start + n);
    var pl = 1 - Math.max(0, o.pan || 0), pr = 1 + Math.min(0, o.pan || 0);
    var lp = o.lowpass ? 1 - Math.exp(-TAU * o.lowpass / SAMPLE_RATE) : 0;
    var hpA = o.highpass ? Math.exp(-TAU * o.highpass / SAMPLE_RATE) : 0;
    var y = 0, px = 0, hy = 0, ph = 0, r = o.noise ? rng(o.noise) : null;
    for (var i = start; i < end; i++) {
      var dt = (i - start) / SAMPLE_RATE;
      var f = o.freq;
      if (o.sweepTo) f = o.freq * Math.pow(o.sweepTo / o.freq, Math.min(1, dt / o.sweepTime));
      var x;
      if (r) x = r() * 2 - 1;
      else { x = wave(o.type, ph); ph += f / SAMPLE_RATE; }
      if (hpA) { hy = hpA * (hy + x - px); px = x; x = hy; }
      if (lp) { y += lp * (x - y); x = y; }
      var s = x * gainAt(dt, o.peak, o.attack, o.decay);
      L[i] += s * pl; R[i] += s * pr;
    }
  }

  function synthesise(p) {
    var total = Math.floor(SAMPLE_RATE * p.seconds);
    var L = new Float32Array(total), R = new Float32Array(total);
    var beat = 60 / p.bpm, bar = beat * 4, secs = p.seconds;
    var bars = Math.ceil(secs / bar), hit = 0;
    for (var b = 0; b < bars; b++) {
      var t0 = b * bar;
      if (t0 >= secs) break;
      var deg = p.progression[b % p.progression.length];
      [0, 2, 4].forEach(function (iv, k) {
        voice(L, R, { t: t0, dur: bar + 0.05, type: 'triangle', freq: midiHz(degree(p, deg + iv, 4)) * (1 + (k - 1) * 0.0023),
          peak: 0.06, attack: Math.min(0.4, bar * 0.2), decay: bar * 0.95, lowpass: p.energy === 'low' ? 1400 : 2200, pan: (k - 1) * 0.3 });
      });
      var bassStep = p.energy === 'low' ? 2 : 1;
      for (var q = 0; q < 4; q += bassStep) {
        var tb = t0 + q * beat; if (tb >= secs) break;
        voice(L, R, { t: tb, dur: beat * bassStep, type: 'sine', freq: midiHz(degree(p, deg + (q === 2 && p.energy === 'high' ? 4 : 0), 2)),
          peak: 0.22, attack: 0.01, decay: beat * bassStep * 0.9 });
      }
      if (p.energy !== 'low' && b > 0) {
        for (var e = 0; e < 8; e++) {
          var ta = t0 + e * beat / 2; if (ta >= secs) break;
          voice(L, R, { t: ta, dur: beat / 2, type: 'square', freq: midiHz(degree(p, deg + [0, 2, 4, 7][p.arpeggio[e] % 4], 5)),
            peak: 0.025, attack: 0.005, decay: beat * 0.4, lowpass: 2600, pan: e % 2 ? 0.25 : -0.25 });
        }
      }
      var kicks = p.energy === 'low' ? [0] : (p.energy === 'mid' ? [0, 2] : [0, 1.5, 2, 3.5]);
      var snares = p.energy === 'low' ? [] : [1, 3];
      var hatStep = p.energy === 'low' ? 1 : (p.energy === 'mid' ? 0.5 : 0.25);
      kicks.forEach(function (k) {
        var tk = t0 + k * beat; if (tk >= secs) return;
        voice(L, R, { t: tk, dur: 0.3, type: 'sine', freq: 150, sweepTo: 45, sweepTime: 0.12, peak: 0.5, attack: 0.003, decay: 0.25 });
      });
      snares.forEach(function (s) {
        var ts = t0 + s * beat; if (ts >= secs) return;
        voice(L, R, { t: ts, dur: 0.2, noise: (p.seed ^ (++hit * 2654435761)) >>> 0, highpass: 1200, peak: 0.18, attack: 0.002, decay: 0.16 });
      });
      for (var h = 0; h < 4; h += hatStep) {
        var th = t0 + h * beat; if (th >= secs) break;
        voice(L, R, { t: th, dur: 0.07, noise: (p.seed ^ (++hit * 2654435761)) >>> 0, highpass: 7000, peak: (h % 1 === 0) ? 0.07 : 0.045, attack: 0.001, decay: 0.05, pan: 0.2 });
      }
    }
    // Master fade in and out.
    var fadeIn = Math.min(1.5, secs / 6), fadeOut = 2;
    for (var i = 0; i < total; i++) {
      var t = i / SAMPLE_RATE, g = 0.9;
      if (t < fadeIn) g *= t / fadeIn;
      if (t > secs - fadeOut) g *= Math.max(0, (secs - t) / fadeOut);
      L[i] *= g; R[i] *= g;
    }
    return [L, R];
  }

  function wav(channels) {
    var ch = channels.length, len = channels[0].length, rate = SAMPLE_RATE;
    var data = channels;
    var peak = 0;
    for (var c = 0; c < ch; c++) {
      var d = data[c];
      for (var i = 0; i < len; i++) { var a = Math.abs(d[i]); if (a > peak) peak = a; }
    }
    var gain = peak > 0 ? Math.min(4, 0.89 / peak) : 1;
    var bytes = len * ch * 2;
    var ab = new ArrayBuffer(44 + bytes), v = new DataView(ab);
    function str(o, s) { for (var k = 0; k < s.length; k++) v.setUint8(o + k, s.charCodeAt(k)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, bytes, true);
    var off = 44;
    for (var n = 0; n < len; n++) {
      for (var cc = 0; cc < ch; cc++) {
        var s = data[cc][n] * gain;
        s = s > 1 ? 1 : (s < -1 ? -1 : s);
        v.setInt16(off, Math.round(s * 32767), true); off += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  function render(brief, seconds) {
    return new Promise(function (resolve, reject) {
      // Yield once so the page can paint its "making" line first.
      setTimeout(function () {
        try {
          var p = plan(brief, seconds);
          var ch = synthesise(p);
          resolve({ blob: wav(ch), plan: p, sampleRate: SAMPLE_RATE, seconds: p.seconds });
        } catch (e) { reject(e); }
      }, 0);
    });
  }

  root.MusicSynth = { plan: plan, render: render, wav: wav, SAMPLE_RATE: SAMPLE_RATE, MIN_SECS: MIN_SECS, MAX_SECS: MAX_SECS };
})(typeof window !== 'undefined' ? window : this);
