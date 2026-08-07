#!/usr/bin/env python3
"""
scripts/gen-brand-audio.py — KNICKGASM original brand audio beds.

Synthesizes ORIGINAL, royalty-free audio for video/motion ads and the music
page. Nothing is sampled or downloaded: every sound is generated from scratch
(sine/saw/noise + envelopes) with the Python stdlib only (wave, math, struct),
so the tracks are safe to use in paid ads with no licensing exposure.

Three beds, all 90 BPM trap/streetwear flavour, seamlessly loopable:
  knickgasm-brand-beat.wav   ~30s  full bed  — hero video ads, brand films
  knickgasm-reels-loop.wav   ~15s  tighter   — Reels/TikTok/Stories cutdowns
  knickgasm-ad-underscore.wav ~20s low-key   — sits under voiceover/dialogue

Run: python3 scripts/gen-brand-audio.py
Out: assets/media/*.wav
"""
import math
import os
import struct
import wave

SR = 44100
BPM = 90.0
BEAT = 60.0 / BPM           # 0.6667 s
BAR = BEAT * 4
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT_DIR = os.path.join(ROOT, 'assets', 'media')

# Deterministic noise (LCG) so every run produces byte-identical files.
_seed = 20260803


def rnd():
    global _seed
    _seed = (1103515245 * _seed + 12345) % (1 << 31)
    return (_seed / (1 << 31)) * 2.0 - 1.0


def note(semitones_from_a4):
    return 440.0 * (2.0 ** (semitones_from_a4 / 12.0))


def add(buf, start_s, samples, gain=1.0):
    i = int(start_s * SR)
    n = len(buf)
    for k, v in enumerate(samples):
        j = i + k
        if 0 <= j < n:
            buf[j] += v * gain


def env(n, attack, decay, sustain=0.0, release=None):
    """Simple AD/ADSR envelope as a list of multipliers of length n."""
    a = max(1, int(attack * SR))
    d = max(1, int(decay * SR))
    out = []
    for i in range(n):
        if i < a:
            out.append(i / a)
        elif i < a + d:
            t = (i - a) / d
            out.append(1.0 - (1.0 - sustain) * t)
        else:
            if release:
                r = max(1, int(release * SR))
                t = min(1.0, (i - a - d) / r)
                out.append(sustain * (1.0 - t))
            else:
                out.append(sustain)
    return out


def kick(dur=0.42):
    """808-style kick: pitch-swept sine with a click transient."""
    n = int(dur * SR)
    e = env(n, 0.001, dur * 0.9, 0.0)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / SR
        f = 130.0 * math.exp(-t * 26.0) + 44.0        # sweep 130Hz -> 44Hz
        phase += 2 * math.pi * f / SR
        click = math.exp(-t * 400.0) * rnd() * 0.25
        out.append((math.sin(phase) + click) * e[i])
    return out


def snare(dur=0.28):
    """Layered noise burst + tuned body."""
    n = int(dur * SR)
    e = env(n, 0.001, dur * 0.75, 0.0)
    out = []
    for i in range(n):
        t = i / SR
        body = math.sin(2 * math.pi * 185.0 * t) * 0.35 * math.exp(-t * 26.0)
        noise = rnd() * math.exp(-t * 15.0)
        out.append((noise * 0.7 + body) * e[i] * 0.85)
    return out


def hat(dur=0.055, tone=0.55):
    """Closed hat: filtered noise, short."""
    n = int(dur * SR)
    e = env(n, 0.0006, dur * 0.85, 0.0)
    out = []
    prev = 0.0
    for i in range(n):
        x = rnd()
        hp = x - prev * tone          # crude high-pass
        prev = x
        out.append(hp * e[i] * 0.5)
    return out


def sub808(freq, dur):
    """Sustained 808 bass with soft saturation and a slight pitch drop."""
    n = int(dur * SR)
    e = env(n, 0.006, 0.05, 0.85, dur * 0.55)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / SR
        f = freq * (1.0 + 0.06 * math.exp(-t * 18.0))
        phase += 2 * math.pi * f / SR
        s = math.sin(phase)
        out.append(math.tanh(s * 1.7) * 0.75 * e[i])
    return out


def pluck(freq, dur, gain=1.0, detune=0.004):
    """Bright detuned-saw pluck for the melodic hook."""
    n = int(dur * SR)
    e = env(n, 0.004, dur * 0.55, 0.25, dur * 0.4)
    out = []
    p1 = p2 = 0.0
    for i in range(n):
        p1 += 2 * math.pi * freq / SR
        p2 += 2 * math.pi * (freq * (1 + detune)) / SR
        # band-limited-ish saw via summed harmonics (cheap, warm)
        s = 0.0
        for h in (1, 2, 3, 4):
            s += math.sin(p1 * h) / h + math.sin(p2 * h) / h
        out.append(s * 0.16 * e[i] * gain)
    return out


def pad(freq, dur, gain=0.5):
    """Wide, slow-attack pad for the atmosphere layer."""
    n = int(dur * SR)
    e = env(n, dur * 0.28, dur * 0.2, 0.7, dur * 0.5)
    out = []
    p = [0.0, 0.0, 0.0]
    for i in range(n):
        t = i / SR
        vib = 1.0 + 0.0025 * math.sin(2 * math.pi * 0.7 * t)
        s = 0.0
        for k, mult in enumerate((1.0, 1.005, 0.4988)):
            p[k] += 2 * math.pi * freq * mult * vib / SR
            s += math.sin(p[k])
        out.append(s * 0.18 * e[i] * gain)
    return out


# ── Composition ─────────────────────────────────────────────────────────────
# Key: F minor (dark, street). Chords: Fm - Db - Ab - Eb, one bar each.
F2, AB2, DB3, EB3 = note(-16), note(-13), note(-8), note(-6)
CHORDS = [
    (F2,  [note(-4), note(0), note(3)]),    # Fm
    (DB3, [note(-3), note(1), note(4)]),    # Db
    (AB2, [note(-1), note(3), note(6)]),    # Ab
    (EB3, [note(-6), note(-2), note(1)]),   # Eb
]
HOOK = [0, 3, 2, 3, 0, -2, 0, 3]            # scale-degree motif (semitone offsets)


def build(bars, *, hats=True, hook=True, pads=True, drums=True, gain=1.0):
    total = bars * BAR + 0.6
    buf = [0.0] * int(total * SR)
    for b in range(bars):
        t0 = b * BAR
        root, chord = CHORDS[b % len(CHORDS)]
        if pads:
            for f in chord:
                add(buf, t0, pad(f, BAR * 1.02, 0.42), 0.5)
        if drums:
            # kick pattern (trap: 1, 1&a, 3, 3.75)
            for off in (0.0, 0.75, 2.0, 2.75, 3.5):
                add(buf, t0 + off * BEAT, kick(), 0.95)
            # snare/clap on 2 and 4
            for off in (1.0, 3.0):
                add(buf, t0 + off * BEAT, snare(), 0.55)
            if hats:
                step = BEAT / 2
                k = 0
                t = 0.0
                while t < BAR - 1e-6:
                    # rolls: every 4th bar triple-time on the last beat
                    if b % 4 == 3 and t > BEAT * 3:
                        for r in range(3):
                            add(buf, t0 + t + r * (step / 3), hat(0.045), 0.34)
                    else:
                        add(buf, t0 + t, hat(), 0.4 if k % 2 == 0 else 0.26)
                    t += step
                    k += 1
        # 808 bassline: root for 2 beats, 5th-ish movement after
        add(buf, t0, sub808(root, BEAT * 2.1), 0.85)
        add(buf, t0 + BEAT * 2.5, sub808(root * 1.335, BEAT * 1.4), 0.7)
        if hook:
            base = chord[0] * 2.0
            for i, deg in enumerate(HOOK):
                if (b + i) % 3 == 2 and b % 2 == 0:
                    continue                      # leave space, avoid busy-ness
                f = base * (2 ** (deg / 12.0))
                add(buf, t0 + i * (BEAT / 2), pluck(f, BEAT * 0.46,
                    0.9 if i % 4 == 0 else 0.55), 0.5)
    # normalize with headroom + soft limiter
    peak = max(abs(v) for v in buf) or 1.0
    target = 0.89 * gain
    return [math.tanh((v / peak) * target * 1.12) * 0.97 for v in buf]


def write_wav(path, samples):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for v in samples:
            frames += struct.pack('<h', int(max(-1.0, min(1.0, v)) * 32767))
        w.writeframes(bytes(frames))
    return os.path.getsize(path)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    jobs = [
        ('knickgasm-brand-beat.wav',     dict(bars=12, gain=1.0)),
        ('knickgasm-reels-loop.wav',     dict(bars=6,  gain=1.0)),
        ('knickgasm-ad-underscore.wav',  dict(bars=8,  hook=False, hats=False, gain=0.62)),
    ]
    for name, kw in jobs:
        global _seed
        _seed = 20260803                     # reset per track → reproducible
        p = os.path.join(OUT_DIR, name)
        size = write_wav(p, build(**kw))
        print(f'  {name}  {size/1024/1024:.2f} MB')
    print('Original KNICKGASM audio beds written to assets/media/ (90 BPM, F minor, loopable).')


if __name__ == '__main__':
    main()
