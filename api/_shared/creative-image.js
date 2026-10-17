'use strict';

/**
 * Standalone creative-image helper — headless, in-process call into the
 * existing /api/ai/image.js provider cascade (Gemini → OpenAI → Pollinations)
 * via a mock req/res pair, so callers get the full waterfall without an HTTP
 * hop and without adding a Vercel function.
 *
 * This is a deliberate standalone copy of the proven pattern in
 * smart-brain-plan.js (generateCreativeImage / uploadCreative) so that new
 * consumers (lifecycle-mailer-build.js) do not couple themselves to the Smart
 * Brain module. smart-brain-plan.js itself is intentionally NOT modified.
 *
 * Both functions are failure-silent: any error resolves to null and the
 * caller ships without an image.
 */

// Invoke the existing image handler in-process via a mock res object, so we get
// the full Gemini → OpenAI → free-Pollinations cascade without an HTTP hop.
//
// `admitted` (optional): { caller, headers } from a route that has ALREADY
// gated and metered this work (the pipeline's images stage). The cascade then
// runs unmetered (image.js `inProcess`) as THAT caller, so the picture is
// that caller's brand and no second hold is taken per image. `free: false`
// asks the route for no keyless rung and skips the floor below (the caller
// honours FREE_GENERATION=off). `report` (an object) receives the route's
// `detail` and `attempts` when it produced nothing. `budgetMs` caps the cascade.
async function generateCreativeImage(prompt, { size = '1024x1024', mode = '', admitted = null, free, report = null, budgetMs = 55000 } = {}) {
  if (!prompt || !String(prompt).trim()) return null;
  let handler;
  try { handler = require('../ai/image.js'); } catch (_) { return null; }
  if (admitted) {
    if (!admitted.caller || !admitted.caller.ok || typeof handler.inProcess !== 'function') return null;
    handler = handler.inProcess;
  }
  return await new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const done = (v) => { if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve(v); } };
    const res = {
      setHeader() {}, status() { return res; }, end() { done(null); return res; },
      json(obj) {
        if (!(obj && obj.image_data_url) && report && obj) { report.detail = obj.detail || obj.message || obj.error || null; report.attempts = obj.attempts || []; }
        done(obj && obj.image_data_url ? { image: obj.image_data_url, provider: obj.provider, model: obj.model, url: obj.image_url || null } : null); return res;
      },
    };
    // budget_ms keeps the cascade inside this function's own 60s wait, so a
    // slow provider is cut off by the cascade (which then tries the next one)
    // rather than by the timer below (which gives up on all of them).
    // The route admits a signed-in person or the deployment's own scheduler.
    // This call is the server's own work (a slot being built, a trigger mailer),
    // and it carried NO credentials, so since the route gained its caller gate
    // every one of these was refused (401) and every server-side image was
    // null (found 2026-10-17). It names itself as the scheduler when the
    // deployment has one, else carries the person's own session.
    const budget = Math.max(5000, Math.min(55000, Number(budgetMs) || 55000));
    const reqBody = { prompt: String(prompt).slice(0, 1800), size, quality: 'high', mode, budget_ms: budget };
    if (free === false) reqBody.free = false;
    const req = admitted
      ? { method: 'POST', headers: Object.assign({}, admitted.headers || {}), body: reqBody, __admitted: true, __caller: admitted.caller }
      : { method: 'POST', headers: internalAuth(), body: reqBody };
    Promise.resolve().then(() => handler(req, res)).catch((e) => { if (report) report.detail = String((e && e.message) || e); done(null); });
    timer = setTimeout(() => done(null), budget + 5000);
  }).then((got) => got || (free === false ? null : freeImage(prompt, size)));
}

function internalAuth() {
  const cron = process.env.CRON_SECRET || '';
  if (cron) return { authorization: 'Bearer ' + cron };
  try {
    const r = require('./request-scope.js').currentRequest();
    const a = r && r.headers && (r.headers.authorization || r.headers.Authorization);
    if (a) return { authorization: a };
  } catch (_) { /* no request in scope */ }
  return {};
}

// The free, keyless floor (2026-10-17): when the route produced nothing (no
// key, no scheduler, a refusal), Pollinations' own address for this prompt,
// probed once for a real image. FREE_GENERATION=off turns it off.
async function freeImage(prompt, size) {
  if (String(process.env.FREE_GENERATION || '').toLowerCase() === 'off') return null;
  const [w, h] = String(size || '1024x1024').split('x').map((n) => Number(n) || 1024);
  let seed = 2166136261;
  for (const ch of String(prompt)) { seed ^= ch.charCodeAt(0); seed = Math.imul(seed, 16777619); }
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(String(prompt).slice(0, 900))}?width=${w}&height=${h}&seed=${(seed >>> 0) % 1000000}&nologo=true&model=flux`;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), 60000) : null;
  try {
    const r = await fetch(url, { method: 'GET', signal: ctl ? ctl.signal : undefined });
    const ct = String((r.headers && r.headers.get && r.headers.get('content-type')) || '').toLowerCase();
    if (!r.ok || !ct.startsWith('image/')) return null;
    const buf = await r.arrayBuffer();
    return buf.byteLength >= 5000 ? { image: url, url, provider: 'pollinations', model: 'flux', keyless: true } : null;
  } catch (_) { return null; } finally { if (t) clearTimeout(t); }
}

// Upload a base64 data-URL creative to the public Supabase Storage bucket and
// return its hosted URL (so we persist a small URL, not a multi-MB data-URL).
// Returns null if it's not a data-URL or storage isn't configured — callers then
// keep the inline data-URL, so creatives still work with no storage set up.
async function uploadCreative(dataUrl, name) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return null;
  let supa;
  try { supa = require('./supa.js'); } catch (_) { return null; }
  try {
    const ext = m[1].includes('png') ? 'png' : m[1].includes('webp') ? 'webp' : 'jpg';
    const safe = String(name || 'creative').replace(/[^a-z0-9-]/gi, '_').slice(0, 60);
    const path = `${safe}-${Date.now().toString(36)}.${ext}`;
    const { public_url } = await supa.uploadObject('smart-brain-creatives', path, Buffer.from(m[2], 'base64'), m[1]);
    return public_url || null;
  } catch (_) { return null; }
}

// Where a generated image lives, never base64 (2026-10-17): the hosted copy when
// storage answers, else the free generator's own address (Pollinations serves the
// same picture at it every time), else nothing. A mailer carries a URL or no image.
async function hostedUrl(gen, name) {
  if (!gen || !gen.image) return null;
  if (/^https:\/\//i.test(gen.image)) return gen.image;
  const up = await uploadCreative(gen.image, name).catch(() => null);
  if (up) return up;
  return gen.url && /^https:\/\//i.test(gen.url) ? gen.url : null;
}

module.exports = { generateCreativeImage, uploadCreative, hostedUrl };
