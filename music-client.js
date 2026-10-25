/*
 * music-client.js - one way for a page to get a composed track (2026-10-25).
 *
 * POST /api/brain?action=music-compose answers the audio itself, or 202 with
 * a job when Replicate is still making the track; the job is polled at
 * ?action=music-job until the audio comes back. Resolves
 * { blob, url, type, provider, model, quality, note, sung }; rejects with an
 * Error carrying the server's own sentence (`status`, `code`).
 */
(function (root) {
  'use strict';
  var LABEL = {
    lyria: 'Composed by Lyria, Google\'s music model.',
    elevenlabs: 'Composed by ElevenLabs Music.',
    replicate: 'Composed on Replicate (ACE-Step sings, MusicGen plays).',
  };
  function dec(s) { try { return decodeURIComponent(s || ''); } catch (_) { return s || ''; } }
  function wait(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function failure(r) {
    var j = null; try { j = await r.json(); } catch (_) {}
    var e = new Error((j && (j.message || j.error)) || ('The server answered ' + r.status + '.'));
    e.status = r.status; if (j && j.error) e.code = j.error;
    return e;
  }
  async function audioOf(r, meta) {
    var type = r.headers.get('content-type') || '';
    var blob = await r.blob();
    var provider = r.headers.get('x-music-provider') || meta.provider || '';
    return {
      blob: blob, url: URL.createObjectURL(blob), type: type,
      provider: provider, model: r.headers.get('x-music-model') || meta.model || '',
      quality: r.headers.get('x-music-quality') || meta.quality || (/wav/.test(type) ? 'sketch' : ''),
      note: [LABEL[provider] || '', dec(r.headers.get('x-music-note')) || meta.message || ''].filter(Boolean).join(' '),
      sung: dec(r.headers.get('x-music-sung')) || meta.sung || '',
    };
  }
  async function compose(body, opts) {
    opts = opts || {};
    var r = await fetch('/api/brain?action=music-compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var type = r.headers.get('content-type') || '';
    if (r.ok && /audio/.test(type)) return audioOf(r, {});
    if (r.status !== 202) throw await failure(r);
    var meta = await r.json();
    if (typeof opts.onProgress === 'function') opts.onProgress('The track is still being made. It plays here as soon as it is ready.');
    var until = Date.now() + (opts.maxWaitMs || 8 * 60 * 1000);
    while (Date.now() < until) {
      await wait(4000);
      var p = await fetch('/api/brain?action=music-job&id=' + encodeURIComponent(meta.job));
      var pt = p.headers.get('content-type') || '';
      if (p.ok && /audio/.test(pt)) return audioOf(p, meta);
      if (p.status !== 202) throw await failure(p);
    }
    var e = new Error('The track is taking longer than usual. Press Generate again in a minute.');
    e.status = 504; throw e;
  }
  root.MusicClient = { compose: compose, LABEL: LABEL };
})(typeof window !== 'undefined' ? window : globalThis);
