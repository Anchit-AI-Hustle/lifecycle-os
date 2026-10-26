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
 *   - genre words choose the band (electronic, acoustic, lo-fi, cinematic,
 *     rock, pop): which waves play the pad, bass and lead, the drum pattern,
 *     the swing, and whether the lead plays a melody or an arpeggio;
 *   - the length is the page's own length field, held to 5-60 seconds.
 * Everything else (key, progression, melody, band when no genre is named)
 * comes from a hash of the brief AND the take. A take is one press of
 * Compose (2026-10-26, the operator: "the same song is returned every time"):
 * every press sends a new take, so it hears a new track; the SAME brief and
 * take still give the SAME track, byte for byte. No take = take ''.
 *
 * Why not an OfflineAudioContext node graph: measured 2026-10-17 in Chromium,
 * two renders of the SAME graph differed by one LSB on 62 to 200 samples, so
 * a graph cannot keep "same brief, same bytes". Computing the samples here
 * keeps it, needs no user gesture (iOS Safari) and plays nothing aloud. The
 * result is a 16-bit PCM stereo WAV whose RIFF header is written here; the
 * page plays it in an <audio> element. It is a generated instrumental bed, not
 * a composed song, and the page says so.
 *
 * window.MusicSynth = { plan(brief, seconds, {take}), render(brief, seconds, {take}) -> Promise<{blob, plan, sampleRate, seconds}>, wav([left, right]) }
 */
(function (root) {
  'use strict';

  var SAMPLE_RATE = 44100;
  var MIN_SECS = 5, MAX_SECS = 60;

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
  // The band per genre. pad/bass/lead are waves; kicks/snares are beats in a
  // bar; hat is the hat step in beats (0 = none); swing delays every second
  // eighth; melody = the lead plays a tune (else an arpeggio); pluck = short
  // notes instead of held ones.
  var STYLES = {
    electronic: { words: ['electronic', 'edm', 'house', 'techno', 'synth', 'dance', 'club', 'trance', 'electro', 'future'], pad: 'saw', bass: 'saw', lead: 'square', kicks: [0, 1, 2, 3], snares: [1, 3], hat: 0.5, offHat: true, swing: 0, melody: true, pluck: false, lowpass: 2400, label: 'electronic: saw pads, four-on-the-floor kick, off-beat hats, square lead' },
    acoustic: { words: ['acoustic', 'folk', 'guitar', 'unplugged', 'country', 'organic', 'indie folk'], pad: 'triangle', bass: 'triangle', lead: 'triangle', kicks: [0, 2.5], snares: [], hat: 1, offHat: false, swing: 0.08, melody: true, pluck: true, lowpass: 1800, label: 'acoustic: plucked strings, soft kick, light shaker, a sung-style melody' },
    lofi: { words: ['lo-fi', 'lofi', 'lo fi', 'hip hop', 'hip-hop', 'chillhop', 'boom bap', 'jazz', 'jazzy', 'study'], pad: 'triangle', bass: 'sine', lead: 'sine', kicks: [0, 2.25], snares: [1, 3], hat: 0.5, offHat: false, swing: 0.16, melody: true, pluck: false, lowpass: 1200, label: 'lo-fi: dusty keys, swung hats, laid-back kick and snare, a soft lead' },
    cinematic: { words: ['cinematic', 'orchestral', 'epic', 'film', 'score', 'trailer', 'strings', 'piano', 'ambient'], pad: 'saw', bass: 'sine', lead: 'triangle', kicks: [0], snares: [], hat: 0, offHat: false, swing: 0, melody: true, pluck: false, lowpass: 1500, label: 'cinematic: wide string-like pads, a low pulse, a slow melody that rises' },
    rock: { words: ['rock', 'punk', 'grunge', 'garage', 'metal', 'anthem', 'stadium', 'guitar riff'], pad: 'square', bass: 'saw', lead: 'saw', kicks: [0, 1.5, 2], snares: [1, 3], hat: 0.5, offHat: false, swing: 0, melody: false, pluck: true, lowpass: 3000, label: 'rock: driving power chords, steady eighths on the hat, kick and backbeat snare' },
    pop: { words: ['pop', 'jingle', 'catchy', 'radio', 'upbeat pop', 'funk', 'disco', 'reggaeton', 'afrobeat'], pad: 'triangle', bass: 'sine', lead: 'square', kicks: [0, 2], snares: [1, 3], hat: 0.5, offHat: false, swing: 0, melody: true, pluck: true, lowpass: 2600, label: 'pop: bright plucked chords, a hook melody, kick and clap' }
  };
  var STYLE_ORDER = ['pop', 'electronic', 'acoustic', 'lofi', 'cinematic', 'rock'];
  function styleOf(text, r) {
    var best = '', n = 0;
    for (var i = 0; i < STYLE_ORDER.length; i++) {
      var k = STYLE_ORDER[i], c = count(text, STYLES[k].words);
      if (c > n) { n = c; best = k; }
    }
    return best ? { name: best, from: 'brief' } : { name: STYLE_ORDER[Math.floor(r() * STYLE_ORDER.length)], from: 'take' };
  }

  var KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function plan(brief, seconds, opts) {
    var text = String(brief || '');
    var secs = Math.round(Number(seconds));
    if (!isFinite(secs) || secs <= 0) secs = 30;
    secs = Math.max(MIN_SECS, Math.min(MAX_SECS, secs));
    var take = String((opts && opts.take) || '').slice(0, 64);
    var seed = hash(text + '|' + secs + (take ? '|' + take : ''));
    var r = rng(seed);
    var style = styleOf(text, r);
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
    // A two-bar motif: eight steps, each a scale degree or a rest (-1), held
    // for one or two eighths; the second half answers the first.
    var motif = [], prev = Math.floor(r() * 5);
    for (var m = 0; m < 16; m++) {
      if (m % 2 === 1 && r() < 0.45) { motif.push(-1); continue; }
      prev = Math.max(0, Math.min(9, prev + [-2, -1, -1, 0, 1, 1, 2, 3][Math.floor(r() * 8)]));
      motif.push(prev);
    }
    var st = STYLES[style.name];
    return {
      seconds: secs, seed: seed, take: take, mode: mode, energy: energy, bpm: bpm, tempo_source: tempoSource,
      key: KEY_NAMES[rootPc] + ' ' + mode, root_pc: rootPc, progression: prog, arpeggio: arp, motif: motif,
      style: style.name, style_from: style.from, band: st.label,
      summary: style.name + ' (' + (style.from === 'brief' ? 'from the brief' : 'picked for this take') + '), ' + KEY_NAMES[rootPc] + ' ' + mode + ', ' + bpm + ' BPM (' + tempoSource + '), ' + energy + ' energy, ' + secs + ' seconds'
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
    if (type === 'saw') return 2 * x - 1;
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
    var st = STYLES[p.style] || STYLES.pop;
    var beat = 60 / p.bpm, bar = beat * 4, secs = p.seconds;
    var bars = Math.ceil(secs / bar), hit = 0;
    var cut = p.energy === 'low' ? st.lowpass * 0.7 : st.lowpass;
    var swingAt = function (e) { return e % 2 ? st.swing * beat : 0; };
    for (var b = 0; b < bars; b++) {
      var t0 = b * bar;
      if (t0 >= secs) break;
      var deg = p.progression[b % p.progression.length];
      var intro = b === 0 && bars > 3, last = b === bars - 1 && bars > 3;
      // Chords: held pads, or plucked on each beat.
      [0, 2, 4].forEach(function (iv, k) {
        var f = midiHz(degree(p, deg + iv, 4)) * (1 + (k - 1) * 0.0023);
        if (st.pluck && !intro) {
          for (var q = 0; q < 4; q++) {
            var tq = t0 + q * beat + k * 0.012; if (tq >= secs) break;
            voice(L, R, { t: tq, dur: beat, type: st.pad, freq: f, peak: 0.05, attack: 0.004, decay: beat * 0.8, lowpass: cut, pan: (k - 1) * 0.35 });
          }
        } else {
          voice(L, R, { t: t0, dur: bar + 0.05, type: st.pad, freq: f, peak: st.pad === 'saw' ? 0.035 : 0.06, attack: Math.min(0.4, bar * 0.2), decay: bar * 0.95, lowpass: cut * 0.8, pan: (k - 1) * 0.3 });
        }
      });
      if (intro) continue;
      var bassStep = p.energy === 'low' || p.style === 'cinematic' ? 2 : 1;
      for (var q2 = 0; q2 < 4; q2 += bassStep) {
        var tb = t0 + q2 * beat; if (tb >= secs) break;
        voice(L, R, { t: tb, dur: beat * bassStep, type: st.bass, freq: midiHz(degree(p, deg + (q2 === 2 && p.energy === 'high' ? 4 : 0), 2)),
          peak: st.bass === 'sine' ? 0.22 : 0.12, attack: 0.01, decay: beat * bassStep * 0.9, lowpass: st.bass === 'sine' ? 0 : 500 });
      }
      // The lead: the take's melody (every other phrase answered an octave
      // up near the end), or an arpeggio over the chord.
      if (p.energy !== 'low' || st.melody) {
        var phrase = (b - 1) % 2;
        for (var e = 0; e < 8; e++) {
          var ta = t0 + e * beat / 2 + swingAt(e); if (ta >= secs) break;
          var d = st.melody ? p.motif[phrase * 8 + e] : [0, 2, 4, 7][p.arpeggio[e] % 4] + deg;
          if (d < 0) continue;
          var oct = st.melody && b >= bars - 3 && bars > 6 ? 6 : 5;
          voice(L, R, { t: ta, dur: beat, type: st.lead, freq: midiHz(degree(p, d, oct)),
            peak: st.melody ? 0.045 : 0.025, attack: 0.006, decay: st.melody ? beat * 0.85 : beat * 0.4, lowpass: cut + 400, pan: st.melody ? 0.05 : (e % 2 ? 0.25 : -0.25) });
        }
      }
      if (last) continue;
      var kicks = p.energy === 'low' ? [0] : st.kicks;
      var snares = p.energy === 'low' ? [] : st.snares;
      var hatStep = p.energy === 'high' && st.hat ? st.hat / 2 : st.hat;
      kicks.forEach(function (k) {
        var tk = t0 + k * beat; if (tk >= secs) return;
        voice(L, R, { t: tk, dur: 0.3, type: 'sine', freq: p.style === 'cinematic' ? 90 : 150, sweepTo: 45, sweepTime: 0.12, peak: p.style === 'cinematic' ? 0.4 : 0.5, attack: 0.003, decay: p.style === 'cinematic' ? 0.6 : 0.25 });
      });
      snares.forEach(function (sn) {
        var ts = t0 + sn * beat; if (ts >= secs) return;
        voice(L, R, { t: ts, dur: 0.2, noise: (p.seed ^ (++hit * 2654435761)) >>> 0, highpass: p.style === 'lofi' ? 900 : 1200, lowpass: p.style === 'lofi' ? 5000 : 0, peak: 0.18, attack: 0.002, decay: 0.16 });
      });
      if (hatStep) {
        for (var h = 0; h < 4; h += hatStep) {
          if (st.offHat && h % 1 === 0) continue;
          var th = t0 + h * beat + (h % 1 ? st.swing * beat : 0); if (th >= secs) break;
          voice(L, R, { t: th, dur: 0.07, noise: (p.seed ^ (++hit * 2654435761)) >>> 0, highpass: p.style === 'acoustic' ? 4000 : 7000, peak: (h % 1 === 0) ? 0.07 : 0.045, attack: 0.001, decay: 0.05, pan: 0.2 });
        }
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

  // The WAV bytes (an ArrayBuffer), for the server, which renders the same
  // track in Node (2026-10-17: made free in the backend, charged as credits).
  function wavBytes(channels, sampleRate) {
    var ch = channels.length, len = channels[0].length, rate = sampleRate || SAMPLE_RATE;
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
    return ab;
  }
  function wav(channels) { return new Blob([wavBytes(channels)], { type: 'audio/wav' }); }
  // `compact`: one channel at half the rate (a pair of samples averaged, then
  // kept once), so a 60 s track is ~2.6 MB and fits a serverless response
  // (Vercel caps one at 4.5 MB; 60 s of 16-bit stereo at 44.1 kHz is 10.6 MB).
  function renderBytes(brief, seconds, opts) {
    var p = plan(brief, seconds, opts);
    var ch = synthesise(p);
    if (!(opts && opts.compact)) return { bytes: wavBytes(ch), plan: p, sampleRate: SAMPLE_RATE, seconds: p.seconds };
    var L = ch[0], R = ch[1] || ch[0], n = Math.floor(L.length / 2), m = new Float32Array(n);
    for (var i = 0; i < n; i++) m[i] = (L[2 * i] + L[2 * i + 1] + R[2 * i] + R[2 * i + 1]) / 4;
    return { bytes: wavBytes([m], SAMPLE_RATE / 2), plan: p, sampleRate: SAMPLE_RATE / 2, seconds: p.seconds };
  }

  function render(brief, seconds, opts) {
    return new Promise(function (resolve, reject) {
      // Yield once so the page can paint its "making" line first.
      setTimeout(function () {
        try {
          var p = plan(brief, seconds, opts);
          var ch = synthesise(p);
          resolve({ blob: wav(ch), plan: p, sampleRate: SAMPLE_RATE, seconds: p.seconds });
        } catch (e) { reject(e); }
      }, 0);
    });
  }

  var api = { STYLES: STYLES, plan: plan, render: render, renderBytes: renderBytes, wav: wav, SAMPLE_RATE: SAMPLE_RATE, MIN_SECS: MIN_SECS, MAX_SECS: MAX_SECS };
  root.MusicSynth = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : {});
