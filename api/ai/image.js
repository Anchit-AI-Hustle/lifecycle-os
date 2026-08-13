// ════════════════════════════════════════════════════════════════════════════
// /api/ai/image — Vercel serverless function
// Server-side image generation with multi-provider cascade.
// Returns base64 data URL (browser embeds directly into <img src=...>).
//
// Provider cascade (tier-ordered — blueprint docs/quality-upgrade-blueprint.md):
//   premium/maxpower: OpenAI gpt-image-2 (auto-demotes to gpt-image-1 on
//                     model-not-found) → Gemini gemini-3-pro-image-preview →
//                     gemini-2.5-flash-image → Imagen fast → Pollinations
//   standard/budget:  FREE-FIRST to protect paid quotas —
//                     gemini-2.5-flash-image (free ~500/day) → Pollinations →
//                     OpenAI (last paid resort)
// Never 502s: on total failure returns 200 + on-brand placeholder data URI.
//
// POST body:
//   { prompt: string, size?: '1024x1024'|'1536x1024'|'1024x1536',
//     quality?: 'low'|'medium'|'high'|'auto', mode?: 'design'|'ad'|'',
//     tier?: 'premium'|'standard'|'fast'|'budget'|'maxpower' }
//
// Env vars:
//   OPENAI_API_KEY / _2 / _3   — OpenAI keys (premium primary)
//   OPENAI_IMAGE_MODEL         — default 'gpt-image-2' (demotes to gpt-image-1)
//   GEMINI_API_KEY             — Google AI / Gemini key
// ════════════════════════════════════════════════════════════════════════════

const { brandPlaceholderDataUri } = require('../_shared/brand-placeholder.js');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENAI_BASE = 'https://api.openai.com/v1';

// The visual brief is built from the ACTIVE BRAND, not hardcoded here.
//
// These five constants used to name one tenant, its four hex colours and its
// product category, so every other brand on the platform received that: a
// publisher asking for a hero image got a photograph of another company's
// product in another company's palette. The palette, typography and even the
// SUBJECT of the picture now come from what the brand actually sells.
//
// The anti-fabrication rules stay constant for every brand and mode - see
// _shared/image-prompt.js. A generated image is the easiest place in the
// product to invent a fact.
const { buildPreamble } = require('../_shared/image-prompt.js');
const brandRuntime = require('../_shared/brand-runtime.js');

// any "no text" directive on purpose — the per-mode preambles above own the
// text policy (ads bake in an overlay; photos/designs handle it themselves).
const QUALITY_SUFFIX = `

QUALITY BAR: ultra-high fidelity, 8K, razor-sharp focus, true-to-life colour, professional colour grading, natural soft lighting, fine material texture, correct anatomy and hands, balanced composition. Avoid: blur, noise, colour banding, JPEG/compression artifacts, plastic skin, warped or melted shapes, extra or missing fingers, duplicated objects, low resolution, oversaturation, HDR halos, uncanny faces.`;

// Map our standard sizes to Gemini aspect ratios.
// Includes the ad-creative sizes (Google 1.91:1 + 1:1, Meta/IG/TikTok 1:1 + 9:16).
const GEMINI_ASPECT_MAP = {
  '1024x1024': '1:1',
  '1024x1536': '3:4',    // portrait (closest to 2:3)
  '1536x1024': '4:3',    // landscape
  '1080x1080': '1:1',    // Meta/IG feed
  '1080x1920': '9:16',   // story / reel / TikTok vertical
  '1200x1200': '1:1',    // Google square
  '1200x628': '16:9'     // Google landscape (closest aspect)
};

// OpenAI gpt-image only accepts a fixed set of sizes — map every requested
// (incl. ad-creative) size to the nearest supported one. The text overlay is
// composited on the client canvas afterwards, so exact pixels here are not
// critical; aspect orientation is what matters.
const OPENAI_SIZE_MAP = {
  '1024x1024': '1024x1024',
  '1024x1536': '1024x1536',
  '1536x1024': '1536x1024',
  '1080x1080': '1024x1024',  // square
  '1200x1200': '1024x1024',  // square
  '1080x1920': '1024x1536',  // vertical
  '1200x628': '1536x1024'    // landscape
};

const POLLINATIONS_SIZE_MAP = {
  '1024x1024': { w: 1024, h: 1024 },
  '1024x1536': { w: 1024, h: 1536 },
  '1536x1024': { w: 1536, h: 1024 },
  '1080x1080': { w: 1080, h: 1080 },
  '1080x1920': { w: 1080, h: 1920 },
  '1200x1200': { w: 1200, h: 1200 },
  '1200x628':  { w: 1200, h: 628 }
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: 'invalid_json_body' }); }
  }
  body = body || {};
  const userPrompt = (body.prompt || '').toString().trim();
  if (!userPrompt) return res.status(400).json({ error: 'missing_prompt' });
  const size = body.size || '1024x1536';
  const quality = body.quality || 'high';
  const validSizes = ['1024x1024', '1536x1024', '1024x1536', '1080x1080', '1080x1920', '1200x1200', '1200x628'];
  const validQualities = ['low', 'medium', 'high', 'auto'];
  if (validSizes.indexOf(size) < 0) return res.status(400).json({ error: 'invalid_size', allowed: validSizes });
  if (validQualities.indexOf(quality) < 0) return res.status(400).json({ error: 'invalid_quality', allowed: validQualities });

  const mode = (body.mode || '').toString().trim();
  // Tier dial: 'premium' (legacy 'maxpower') puts OpenAI gpt-image-2 first (best
  // instruction-following); everything else stays free-first to protect quotas.
  const _tier = (body.tier || process.env.APP_AI_TIER || 'standard').toString().toLowerCase().trim();
  const isPremium = _tier === 'premium' || _tier === 'maxpower' || _tier === 'max-power' || _tier === 'max' || _tier === 'output' || _tier === 'quality';
  // Resolve the caller's brand so the picture is theirs. A lookup failure
  // falls back to tenant zero rather than failing the generation, which is the
  // same contract every other generator here follows.
  const brand = await brandRuntime.resolve(req);
  const preamble = buildPreamble(brand, mode || 'photo');
  // Reserve room so the quality bar always survives the 4000-char cap.
  const finalPrompt = (preamble + userPrompt).substring(0, 4000 - QUALITY_SUFFIX.length) + QUALITY_SUFFIX;

  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKeys = [
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_API_KEY_2,
    process.env.OPENAI_API_KEY_3
  ].filter(Boolean);

  let anyQuotaHit = false; // set when a paid provider fails on quota/billing

  // ── Rung: Gemini native image generation via generateContent ───────────────
  async function tryGeminiNative(models) {
    if (!geminiKey) return null;
    for (const model of models) {
      const endpoint = GEMINI_BASE + '/' + model + ':generateContent?key=' + geminiKey;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      console.log('[image] Trying Gemini native model=' + model);
      try {
        const fetchRes = await fetch(endpoint, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Generate an image based on this description:\n\n' + finalPrompt }] }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!fetchRes.ok) {
          const errText = await fetchRes.text().catch(() => '');
          console.warn('[image] Gemini ' + model + ' → HTTP ' + fetchRes.status, errText.substring(0, 300));
          if (fetchRes.status === 429 || /quota|billing/i.test(errText)) anyQuotaHit = true;
          continue;
        }
        const data = await fetchRes.json();
        const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        if (!parts) { console.warn('[image] Gemini ' + model + ' — no parts in response'); continue; }
        const imgPart = parts.find(p => p.inlineData && p.inlineData.data);
        if (!imgPart) { console.warn('[image] Gemini ' + model + ' — no image part returned'); continue; }
        const mimeType = imgPart.inlineData.mimeType || 'image/png';
        console.log('[image] Success · Gemini native ' + model);
        return { provider: 'gemini', model, image_data_url: 'data:' + mimeType + ';base64,' + imgPart.inlineData.data };
      } catch (e) {
        clearTimeout(timeout);
        console.error('[image] Gemini ' + model + ' exception:', String(e.message || e).substring(0, 200));
        continue;
      }
    }
    return null;
  }

  // ── Rung: Imagen predict API (paid plans only — free tier 400s) ────────────
  async function tryImagen(models) {
    if (!geminiKey) return null;
    const aspectRatio = GEMINI_ASPECT_MAP[size] || '3:4';
    for (const model of models) {
      const endpoint = GEMINI_BASE + '/' + model + ':predict';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      console.log('[image] Trying Gemini Imagen model=' + model + ' aspect=' + aspectRatio);
      try {
        const fetchRes = await fetch(endpoint, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
          body: JSON.stringify({
            instances: [{ prompt: finalPrompt }],
            parameters: { sampleCount: 1, aspectRatio: aspectRatio, personGeneration: 'allow_adult' }
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!fetchRes.ok) {
          const errText = await fetchRes.text().catch(() => '');
          console.warn('[image] Gemini Imagen ' + model + ' → HTTP ' + fetchRes.status, errText.substring(0, 300));
          continue;
        }
        const data = await fetchRes.json();
        const prediction = data.predictions && data.predictions[0];
        if (!prediction || !prediction.bytesBase64Encoded) { continue; }
        const mimeType = prediction.mimeType || 'image/png';
        console.log('[image] Success · Gemini Imagen ' + model);
        return { provider: 'gemini', model, image_data_url: 'data:' + mimeType + ';base64,' + prediction.bytesBase64Encoded };
      } catch (e) {
        clearTimeout(timeout);
        console.error('[image] Gemini Imagen ' + model + ' exception:', String(e.message || e).substring(0, 200));
        continue;
      }
    }
    return null;
  }

  // ── Rung: OpenAI images/generations with within-provider model demotion ────
  // gpt-image-2 (default; best instruction-following) auto-demotes to
  // gpt-image-1 on model-not-found (404, or 400 mentioning the model).
  async function tryOpenai() {
    if (!openaiKeys.length) return null;
    const models = [...new Set([
      process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
      'gpt-image-1'
    ])];
    for (let mi = 0; mi < models.length; mi++) {
      const imageModel = models[mi];
      let demoteModel = false;
      for (let ki = 0; ki < openaiKeys.length; ki++) {
        const key = openaiKeys[ki];
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);
        console.log('[image] Trying OpenAI model=' + imageModel + ' key #' + (ki + 1) + ' (...' + key.slice(-4) + ') size=' + size);
        try {
          const fetchRes = await fetch(OPENAI_BASE + '/images/generations', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({ model: imageModel, prompt: finalPrompt, n: 1, size: (OPENAI_SIZE_MAP[size] || '1024x1024'), quality, output_format: 'png' }),
            signal: controller.signal
          });
          clearTimeout(timeout);

          if (!fetchRes.ok) {
            const errText = await fetchRes.text().catch(() => '');
            console.warn('[image] OpenAI ' + imageModel + ' key #' + (ki + 1) + ' → HTTP ' + fetchRes.status, errText.substring(0, 200));

            const isQuota = (fetchRes.status === 429 || fetchRes.status === 402 || fetchRes.status === 400) &&
              /insufficient_quota|quota|billing|credit|balance/i.test(errText);
            if (isQuota) { anyQuotaHit = true; continue; } // rotate to next key

            const isModelError = fetchRes.status === 404 ||
              errText.includes('model_not_found') || errText.includes('does not exist') || errText.includes('not supported') ||
              (fetchRes.status === 400 && errText.includes(imageModel));
            if (isModelError) { demoteModel = true; break; } // demote within-provider

            continue; // other error → try next key
          }

          const data = await fetchRes.json();
          const imgEntry = data.data && data.data[0];
          if (!imgEntry) { continue; }

          let dataUrl = '';
          if (imgEntry.b64_json) {
            dataUrl = 'data:image/png;base64,' + imgEntry.b64_json;
          } else if (imgEntry.url) {
            try {
              const imgFetch = await fetch(imgEntry.url);
              const buf = await imgFetch.arrayBuffer();
              dataUrl = 'data:image/png;base64,' + Buffer.from(buf).toString('base64');
            } catch (e) { continue; }
          } else { continue; }

          console.log('[image] Success · OpenAI ' + imageModel + ' key #' + (ki + 1) + ' size=' + size);
          return { provider: 'openai', model: imageModel, image_data_url: dataUrl, key_index: ki + 1 };
        } catch (e) {
          clearTimeout(timeout);
          console.error('[image] OpenAI ' + imageModel + ' key #' + (ki + 1) + ' exception:', String(e.message || e).substring(0, 200));
          continue;
        }
      }
      if (demoteModel && mi < models.length - 1) {
        console.warn('[image] OpenAI ' + imageModel + ' unavailable — demoting to ' + models[mi + 1]);
        continue;
      }
      if (!demoteModel) break; // all keys failed for a valid model — no point retrying siblings
    }
    return null;
  }

  // ── Rung: Pollinations FLUX (free, no auth) ─────────────────────────────────
  async function tryPollinations() {
    const dim = POLLINATIONS_SIZE_MAP[size] || POLLINATIONS_SIZE_MAP['1024x1536'];
    const seed = Math.floor(Math.random() * 1000000);
    const models = ['flux-pro', 'flux-realism', 'flux'];
    for (const pollinationsModel of models) {
      const pollUrl = 'https://image.pollinations.ai/prompt/' +
        encodeURIComponent(finalPrompt.substring(0, 1500)) +
        '?width=' + dim.w + '&height=' + dim.h +
        '&seed=' + seed + '&nologo=true&model=' + pollinationsModel + '&enhance=true&quality=hd';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      console.log('[image] Trying Pollinations model=' + pollinationsModel + ' size=' + dim.w + 'x' + dim.h);
      try {
        const imgFetch = await fetch(pollUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (!imgFetch.ok) {
          console.warn('[image] Pollinations ' + pollinationsModel + ' → HTTP ' + imgFetch.status);
          continue;
        }
        const buf = await imgFetch.arrayBuffer();
        // Validate we got actual image data (not an error page)
        if (buf.byteLength < 5000) {
          console.warn('[image] Pollinations ' + pollinationsModel + ' — response too small (' + buf.byteLength + ' bytes), skipping');
          continue;
        }
        const contentType = imgFetch.headers.get('content-type') || 'image/jpeg';
        console.log('[image] Success · Pollinations ' + pollinationsModel + ' (' + Math.round(buf.byteLength / 1024) + ' KB)');
        return {
          provider: 'pollinations', model: pollinationsModel,
          image_data_url: 'data:' + contentType + ';base64,' + Buffer.from(buf).toString('base64')
        };
      } catch (e) {
        clearTimeout(timeout);
        console.error('[image] Pollinations ' + pollinationsModel + ' exception:', String(e.message || e).substring(0, 200));
        continue;
      }
    }
    return null;
  }

  // ── Rung: Cloudflare Workers AI (free daily allowance — Flux-schnell) ────────
  // Independent free bucket; only active when CLOUDFLARE_ACCOUNT_ID + _API_TOKEN
  // are both set. Returns base64 JPEG in result.image (no data: prefix).
  const CF_ACCOUNT = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const CF_TOKEN   = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  async function tryCloudflare() {
    if (!CF_ACCOUNT || !CF_TOKEN) return null;
    const model = process.env.CLOUDFLARE_IMAGE_MODEL || '@cf/black-violet-labs/flux-1-schnell';
    const url = 'https://api.cloudflare.com/client/v4/accounts/' + CF_ACCOUNT + '/ai/run/' + model;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    console.log('[image] Trying Cloudflare model=' + model);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + CF_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: finalPrompt.substring(0, 2000), steps: 6 }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!r.ok) { console.warn('[image] Cloudflare → HTTP ' + r.status); return null; }
      const data = await r.json().catch(() => null);
      const b64 = data && data.result && data.result.image;
      if (!b64 || b64.length < 5000) { console.warn('[image] Cloudflare — no image in response'); return null; }
      console.log('[image] Success · Cloudflare ' + model);
      return { provider: 'cloudflare', model, image_data_url: 'data:image/jpeg;base64,' + b64 };
    } catch (e) {
      clearTimeout(timeout);
      console.error('[image] Cloudflare exception:', String(e.message || e).substring(0, 200));
      return null;
    }
  }

  // ── Tier-ordered cascade ────────────────────────────────────────────────────
  const rungs = isPremium
    ? [
        tryOpenai,                                                             // gpt-image-2 → gpt-image-1
        () => tryGeminiNative(['gemini-3-pro-image-preview', 'gemini-2.5-flash-image']),
        () => tryImagen(['imagen-4.0-fast-generate-001']),
        tryCloudflare,                                                         // free Flux bucket
        tryPollinations
      ]
    : [
        () => tryGeminiNative(['gemini-2.5-flash-image']),                     // free ~500/day
        tryCloudflare,                                                         // free Flux bucket
        tryPollinations,                                                       // free floor
        tryOpenai                                                              // last paid resort
      ];

  const hadKeys = !!(geminiKey || openaiKeys.length > 0);
  for (const rung of rungs) {
    const hit = await rung();
    if (hit) {
      const usedFreeFallback = hit.provider === 'pollinations' && hadKeys;
      return res.status(200).json({
        ok: true, provider: hit.provider, model: hit.model, size, quality,
        image_data_url: hit.image_data_url,
        ...(hit.key_index ? { key_index: hit.key_index } : {}),
        ...(usedFreeFallback ? {
          quota_warning: true,
          quota_note: 'Paid image providers unavailable this call. Using Pollinations ' + hit.model + ' (free). Check Gemini/OpenAI API credits.'
        } : {})
      });
    }
  }

  // Every provider failed. Do NOT 502 — a non-200 leaves the caller with a
  // broken/empty <img>. Instead return 200 with an on-brand placeholder data
  // URI so the mailer / ad / landing page always renders an intentional brand
  // panel (never a broken tile). `placeholder:true` lets callers flag it.
  const noKeys = !hadKeys;
  console.warn('[image] All providers failed — returning on-brand placeholder');
  return res.status(200).json({
    ok: true, provider: 'placeholder', placeholder: true, size, quality,
    image_data_url: brandPlaceholderDataUri(size),
    quota_warning: hadKeys && anyQuotaHit,
    detail: noKeys
      ? 'No image provider key configured. Add OPENAI_API_KEY (verified org + image credits) and/or GEMINI_API_KEY in Vercel. Showing brand placeholder.'
      : 'All image providers failed (OpenAI gpt-image-2/1, Gemini, Pollinations). Usually the OpenAI org is not verified for image generation or has no credits — verify at platform.openai.com → Settings → Organization. Showing brand placeholder.'
  });
};

// ── Metering (Universal Brand Platform) ────────────────────────────────────
// Image generation is the second most expensive call in the app, so it must be
// charged. 'reels' mode is a distinct, pricier product in the catalog.
const _credits = require('../_shared/credits-core.js');
module.exports = _credits.metered(
  module.exports,
  (req, body) => (String(body.mode || '').toLowerCase() === 'reels' ? 'image.reels' : 'image.generate'),
  null,
  {
    // This endpoint never 502s: when every provider fails (or none is keyed) it
    // answers 200 with the on-brand placeholder. The user did not get an image,
    // so the reservation is returned rather than charged.
    successIf: (payload) => !(payload && (payload.placeholder === true || payload.fallback === true)),
  }
);

// Everything this handler calls runs inside the request scope, so llm.js can
// resolve THIS caller's workspace model routing and keys without every one of
// the hundred-odd call sites having to pass `req` down to it. See
// api/_shared/request-scope.js for why an ambient variable would not do.
module.exports = require('../_shared/request-scope.js').wrap(module.exports);
