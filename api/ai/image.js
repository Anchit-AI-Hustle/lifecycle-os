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
// Never 502s: on total failure returns 200 with ok:false, placeholder:true,
// image_data_url:null, the on-brand panel as placeholder_data_url, and every
// attempt with why it failed. A placeholder is never reported as an image.
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

const REAL_QUALITY_SUFFIX = `

QUALITY BAR: high resolution, true-to-life colour, phone-camera realism as the render rules above say, fine material and skin texture, correct anatomy and hands. Avoid: blur, colour banding, JPEG/compression artifacts, plastic skin, beauty smoothing, warped or melted shapes, extra or missing fingers, duplicated objects, oversaturation, HDR halos, uncanny faces.`;

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
  /* Same gate as generate.js. The only `Authorization` strings in this file
     were OUTBOUND headers to the image providers, which is why a grep for auth
     looked like it found something. There was no inbound check at all.
     `__admitted` is set only by server code calling `inProcess` below, on a
     request object it built after its OWN gate admitted the caller (a pipeline
     stage): an HTTP request cannot carry a property, only headers and a body. */
  const admitted = req && req.__admitted === true && req.__caller && req.__caller.ok;
  if (!admitted && !(await require('../_shared/require-caller.js').requireCaller(req, res))) return;
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
  const brand = await brandRuntime.resolve(req, admitted ? { auth: req.__caller } : undefined);
  // The SUBJECT of a product photograph (2026-10-10). A food brand's hero came
  // back as a pair of sneakers because the prompt named no product and the
  // scene text was another brand's. A caller that is photographing a product
  // names it ({ title, category, image_url }, the catalogue row) and may ask
  // for `require_product`: with no product title the request is REFUSED with a
  // marker before any provider is called - an image model asked for "the
  // product" invents one.
  const product = (body.product && typeof body.product === 'object') ? body.product : null;
  const productTitle = product ? String(product.title || '').trim().slice(0, 200) : '';
  if (body.require_product === true && !productTitle) {
    const brandName = (brand && brand.name) || 'this brand';
    return res.status(422).json({
      ok: false, error: 'product_required',
      message: `[DATA REQUIRED BEFORE LAUNCH: hero product, ${brandName}] Select the product this image is of; nothing was generated.`,
    });
  }
  const subjectLine = productTitle
    ? `SUBJECT: the brand's own product "${productTitle}"${product.category ? ` (${String(product.category).slice(0, 80)})` : ''}${/^https?:\/\//i.test(String(product.image_url || '')) ? `, exactly as in its catalogue photograph ${String(product.image_url).slice(0, 400)}` : ''}. Show only this product; invent no other object.\n\n`
    : '';
  const preamble = buildPreamble(brand, mode || 'photo', productTitle ? { product: { title: productTitle, category: product.category } } : null);
  // Pollinations keeps only 1,500 characters: it gets the short preamble, whose
  // anti-fabrication ban and render rules both fit (image-prompt NEVER_SHORT).
  const shortPreamble = buildPreamble(brand, mode || 'photo', Object.assign({ compact: true }, productTitle ? { product: { title: productTitle, category: product.category } } : {}));
  const pollPrompt = (subjectLine + shortPreamble + userPrompt).substring(0, 1500);
  // Reserve room so the quality bar always survives the 4000-char cap. The
  // SUBJECT leads: Pollinations keeps only the first 1,500 characters, and the
  // brand preamble alone is about that long, so a subject placed after it was
  // cut off and the model drew whatever the scene text suggested.
  // A design mockup keeps the studio bar; every real-looking scene takes the
  // phone-camera bar (render-rules.js): "professional colour grading" and
  // "natural soft lighting" are the studio-flat look the render rules ban.
  const qualitySuffix = String(mode || 'photo') === 'design' ? QUALITY_SUFFIX : REAL_QUALITY_SUFFIX;
  const finalPrompt = (subjectLine + preamble + userPrompt).substring(0, 4000 - qualitySuffix.length) + qualitySuffix;

  // Keys cleaned and de-duplicated: the same OpenAI key set twice used to be
  // sent twice after it had already been refused.
  const _clean = (s) => String(s || '').replace(/[﻿​ ]/g, '').trim();
  // The workspace's OWN image-capable keys (OpenAI, Gemini), when it connected
  // any: then only those draw, in the operator's order (OpenAI before Gemini),
  // and neither the platform's keys nor the free rungs are used (2026-10-17).
  // A workspace whose own models cannot draw (Anthropic, Grok text only) uses
  // the platform's order, as before.
  let ownImg = null;
  try {
    const ov = await require('../_shared/workspace-connections-core.js').llmOverridesForCurrentRequest();
    const k = (ov && ov.keys) || {};
    if (_clean(k.openai) || _clean(k.gemini)) ownImg = { openai: _clean(k.openai), gemini: _clean(k.gemini) };
  } catch (_) { ownImg = null; }
  const geminiKey = ownImg ? ownImg.gemini : _clean(process.env.GEMINI_API_KEY);
  const openaiKeys = ownImg ? (ownImg.openai ? [ownImg.openai] : []) : [...new Set([
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_API_KEY_2,
    process.env.OPENAI_API_KEY_3
  ].map(_clean).filter(Boolean))];

  let anyQuotaHit = false; // set when a paid provider fails on quota/billing
  // Every attempt, in order, with why it failed. The placeholder response and
  // the log both carry it, so "all providers failed" always says which and why.
  const attempts = [];
  // A key that was rejected or is out of quota is dead for the rest of this
  // request: Gemini native and Imagen share GEMINI_API_KEY, so a dead key used
  // to be sent once per model of both rungs.
  let geminiKeyDead = false;
  const openaiDead = new Set();

  // The whole request has ONE budget (default 100s of the function's 120s;
  // an in-process caller with its own deadline passes `budget_ms`). Every
  // attempt gets at most what is left, so one hanging provider cannot spend it all.
  const startedAt = Date.now();
  const budgetMs = Math.min(110000, Math.max(5000, Number(body.budget_ms) > 0 ? Number(body.budget_ms)
    : (Number(process.env.IMAGE_TOTAL_BUDGET_MS) > 0 ? Number(process.env.IMAGE_TOTAL_BUDGET_MS) : 100000)));
  const left = () => budgetMs - (Date.now() - startedAt);
  let budgetOut = false;
  const BAD_KEY = /api[ _-]?key[ _-]?(?:not[ _-]?valid|invalid|expired)|invalid[ _-]api[ _-]?key|incorrect api key|API_KEY_INVALID|unauthori[sz]ed|permission_denied/i;
  const BILLING = /insufficient_quota|quota|billing|credit|balance|payment required/i;
  function kindOf(status, errText) {
    const t = String(errText || '');
    if (status === 0) return 'timeout';
    if (status === 401 || (status === 400 && BAD_KEY.test(t))) return 'auth';
    if (status === 402 || ((status === 400 || status === 403 || status === 429) && BILLING.test(t))) return 'billing';
    if (status === 403) return 'auth';
    if (status === 429) return 'rate_limit';
    if (status === 404 || ((status === 400 || status === 422) && /model_not_found|does not exist|not supported|not found|unknown model|invalid model/i.test(t))) return 'model';
    if (status === 200) return 'empty';
    if (status >= 500) return 'transient';
    return 'bad_request';
  }
  function note(provider, model, status, kind, detail) {
    attempts.push({ provider, model, status, reason: kind, detail: String(detail || '').substring(0, 160) });
    if (kind === 'billing') anyQuotaHit = true;
    return kind;
  }

  /** One bounded request: the timer covers the body as well as the headers. */
  async function bounded(url, init, capMs, read) {
    const ms = Math.min(capMs, left());
    if (ms < 1000) { budgetOut = true; return { status: -1, err: 'budget exhausted' }; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ms);
    try {
      const r = await fetch(url, Object.assign({ cache: 'no-store', signal: controller.signal }, init));
      if (!r.ok) return { status: r.status, err: await r.text().catch(() => '') };
      return await read(r);
    } catch (e) {
      return { status: 0, err: controller.signal.aborted ? ('timeout after ' + ms + 'ms') : String((e && e.message) || e) };
    } finally {
      clearTimeout(timeout);
    }
  }
  const readJson = async (r) => {
    try { return { status: 200, data: JSON.parse(await r.text()) }; }
    catch (_) { return { status: 200, err: 'invalid_json_body' }; }
  };

  // ── Rung: Gemini native image generation via generateContent ───────────────
  async function tryGeminiNative(models) {
    if (!geminiKey || geminiKeyDead) return null;
    for (const model of models) {
      console.log('[image] Trying Gemini native model=' + model);
      const out = await bounded(GEMINI_BASE + '/' + model + ':generateContent?key=' + geminiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Generate an image based on this description:\n\n' + finalPrompt }] }],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
        })
      }, 90000, readJson);
      if (out.status === -1) return null;
      if (out.data) {
        const parts = out.data.candidates && out.data.candidates[0] && out.data.candidates[0].content && out.data.candidates[0].content.parts;
        const imgPart = Array.isArray(parts) && parts.find(p => p.inlineData && p.inlineData.data);
        if (imgPart) {
          const mimeType = imgPart.inlineData.mimeType || 'image/png';
          console.log('[image] Success · Gemini native ' + model);
          return { provider: 'gemini', model, image_data_url: 'data:' + mimeType + ';base64,' + imgPart.inlineData.data };
        }
        out.err = 'no image part returned';
      }
      const kind = note('gemini', model, out.status, kindOf(out.status, out.err), out.err);
      console.warn('[image] Gemini ' + model + ' → ' + out.status + ' (' + kind + ')', String(out.err || '').substring(0, 200));
      if (kind === 'auth' || kind === 'billing') { geminiKeyDead = true; return null; }
      if (kind === 'timeout') return null;
    }
    return null;
  }

  // ── Rung: Imagen predict API (paid plans only — free tier 400s) ────────────
  async function tryImagen(models) {
    if (!geminiKey || geminiKeyDead) return null;
    const aspectRatio = GEMINI_ASPECT_MAP[size] || '3:4';
    for (const model of models) {
      console.log('[image] Trying Gemini Imagen model=' + model + ' aspect=' + aspectRatio);
      const out = await bounded(GEMINI_BASE + '/' + model + ':predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({
          instances: [{ prompt: finalPrompt }],
          parameters: { sampleCount: 1, aspectRatio: aspectRatio, personGeneration: 'allow_adult' }
        })
      }, 90000, readJson);
      if (out.status === -1) return null;
      if (out.data) {
        const prediction = out.data.predictions && out.data.predictions[0];
        if (prediction && prediction.bytesBase64Encoded) {
          const mimeType = prediction.mimeType || 'image/png';
          console.log('[image] Success · Gemini Imagen ' + model);
          return { provider: 'gemini', model, image_data_url: 'data:' + mimeType + ';base64,' + prediction.bytesBase64Encoded };
        }
        out.err = 'no image in prediction';
      }
      const kind = note('imagen', model, out.status, kindOf(out.status, out.err), out.err);
      console.warn('[image] Gemini Imagen ' + model + ' → ' + out.status + ' (' + kind + ')', String(out.err || '').substring(0, 200));
      if (kind === 'auth' || kind === 'billing') { geminiKeyDead = true; return null; }
      if (kind === 'timeout') return null;
    }
    return null;
  }

  // ── Rung: OpenAI images/generations with within-provider model demotion ────
  // gpt-image-2 (default; best instruction-following) auto-demotes to
  // gpt-image-1 on model-not-found (404, or 400 mentioning the model). Keys
  // rotate on a key-specific failure; a dead key is never sent again.
  async function tryOpenai() {
    if (!openaiKeys.length) return null;
    const models = [...new Set([
      _clean(process.env.OPENAI_IMAGE_MODEL) || 'gpt-image-2',
      'gpt-image-1'
    ])];
    for (let mi = 0; mi < models.length; mi++) {
      const imageModel = models[mi];
      let demoteModel = false;
      for (let ki = 0; ki < openaiKeys.length; ki++) {
        if (openaiDead.has(ki)) continue;
        const key = openaiKeys[ki];
        console.log('[image] Trying OpenAI model=' + imageModel + ' key #' + (ki + 1) + ' (...' + key.slice(-4) + ') size=' + size);
        const out = await bounded(OPENAI_BASE + '/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({ model: imageModel, prompt: finalPrompt, n: 1, size: (OPENAI_SIZE_MAP[size] || '1024x1024'), quality, output_format: 'png' })
        }, 90000, readJson);
        if (out.status === -1) return null;
        if (out.data) {
          const imgEntry = out.data.data && out.data.data[0];
          let dataUrl = '';
          if (imgEntry && imgEntry.b64_json) {
            dataUrl = 'data:image/png;base64,' + imgEntry.b64_json;
          } else if (imgEntry && imgEntry.url) {
            // The hosted copy is fetched under the same budget, and only an
            // image answer counts: an error page is not a picture.
            const got = await bounded(imgEntry.url, { method: 'GET' }, 30000, async (r) => {
              const ct = (r.headers.get('content-type') || '').toLowerCase();
              const buf = await r.arrayBuffer();
              return (ct.startsWith('image/') && buf.byteLength > 0)
                ? { status: 200, dataUrl: 'data:' + ct.split(';')[0] + ';base64,' + Buffer.from(buf).toString('base64') }
                : { status: 200, err: 'image url returned ' + (ct || 'no content type') };
            });
            if (got.dataUrl) dataUrl = got.dataUrl; else out.err = 'image url unreadable: ' + (got.err || got.status);
          } else {
            out.err = 'no image in response';
          }
          if (dataUrl) {
            console.log('[image] Success · OpenAI ' + imageModel + ' key #' + (ki + 1) + ' size=' + size);
            return { provider: 'openai', model: imageModel, image_data_url: dataUrl, key_index: ki + 1 };
          }
        }
        const kind = note('openai', imageModel, out.status, kindOf(out.status, out.err), out.err);
        console.warn('[image] OpenAI ' + imageModel + ' key #' + (ki + 1) + ' → ' + out.status + ' (' + kind + ')', String(out.err || '').substring(0, 200));
        if (kind === 'auth' || kind === 'billing') { openaiDead.add(ki); continue; } // rotate to next key
        if (kind === 'model' || (out.status === 400 && String(out.err || '').includes(imageModel))) { demoteModel = true; break; } // demote within-provider
        if (kind === 'timeout') return null;
        // rate limit / 5xx / other → next key
      }
      if (openaiDead.size >= openaiKeys.length) return null;
      if (demoteModel && mi < models.length - 1) {
        console.warn('[image] OpenAI ' + imageModel + ' unavailable — demoting to ' + models[mi + 1]);
        continue;
      }
      break; // every live key failed on a valid model — no point retrying siblings
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
        encodeURIComponent(pollPrompt) +
        '?width=' + dim.w + '&height=' + dim.h +
        '&seed=' + seed + '&nologo=true&model=' + pollinationsModel + '&enhance=true&quality=hd';
      console.log('[image] Trying Pollinations model=' + pollinationsModel + ' size=' + dim.w + 'x' + dim.h);
      const out = await bounded(pollUrl, { method: 'GET' }, 90000, async (r) => {
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        const buf = await r.arrayBuffer();
        // An image, and a real one: an HTML error page or a tiny stub answered
        // 200 used to be returned as the picture.
        if (!ct.startsWith('image/')) return { status: 200, err: 'not an image (' + (ct || 'no content type') + ')' };
        if (buf.byteLength < 5000) return { status: 200, err: 'response too small (' + buf.byteLength + ' bytes)' };
        return { status: 200, dataUrl: 'data:' + ct.split(';')[0] + ';base64,' + Buffer.from(buf).toString('base64'), kb: Math.round(buf.byteLength / 1024) };
      });
      if (out.status === -1) return null;
      if (out.dataUrl) {
        console.log('[image] Success · Pollinations ' + pollinationsModel + ' (' + out.kb + ' KB)');
        // Its address too: the same (prompt, seed) answers the same picture, so a
        // caller with nowhere to host the bytes can carry this URL instead of base64.
        return { provider: 'pollinations', model: pollinationsModel, image_data_url: out.dataUrl, image_url: pollUrl };
      }
      const kind = note('pollinations', pollinationsModel, out.status, kindOf(out.status, out.err), out.err);
      console.warn('[image] Pollinations ' + pollinationsModel + ' → ' + out.status + ' (' + kind + ')');
      if (kind === 'timeout') return null;
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
    console.log('[image] Trying Cloudflare model=' + model);
    const out = await bounded('https://api.cloudflare.com/client/v4/accounts/' + CF_ACCOUNT + '/ai/run/' + model, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + CF_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: finalPrompt.substring(0, 2000), steps: 6 })
    }, 60000, readJson);
    if (out.status === -1) return null;
    const b64 = out.data && out.data.result && out.data.result.image;
    if (b64 && b64.length >= 5000) {
      console.log('[image] Success · Cloudflare ' + model);
      return { provider: 'cloudflare', model, image_data_url: 'data:image/jpeg;base64,' + b64 };
    }
    if (out.data) out.err = 'no image in response';
    note('cloudflare', model, out.status, kindOf(out.status, out.err), out.err);
    return null;
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
  // A caller that honours FREE_GENERATION=off (the pipeline's images stage)
  // asks for no keyless rung with `free: false`. Absent, the route is unchanged.
  if (body.free === false) { const i = rungs.indexOf(tryPollinations); if (i >= 0) rungs.splice(i, 1); }
  // FREE FIRST (2026-10-17, the operator: "everything will cost the user
  // credits - but it should be done for free in the backend"). The credit
  // charge is unchanged; the picture is made by the free rungs first (the
  // keyless one, then the free Flux bucket), and a paid provider is reached
  // only when every free one failed. FREE_GENERATION=off keeps the old order.
  const freeFirst = !ownImg && String(process.env.FREE_GENERATION || '').trim().toLowerCase() !== 'off' && body.free !== false;
  if (ownImg) {
    rungs.length = 0;
    if (ownImg.openai) rungs.push(tryOpenai);
    if (ownImg.gemini) rungs.push(() => tryGeminiNative(['gemini-3-pro-image-preview', 'gemini-2.5-flash-image']), () => tryImagen(['imagen-4.0-fast-generate-001']));
  } else if (freeFirst) {
    for (const r of [tryCloudflare, tryPollinations]) {
      const i = rungs.indexOf(r);
      if (i > 0) { rungs.splice(i, 1); rungs.unshift(r); }
    }
  }

  const hadKeys = !!(geminiKey || openaiKeys.length > 0);
  for (const rung of rungs) {
    if (left() < 1000) { budgetOut = true; break; }
    const hit = await rung();
    if (hit) {
      // Whose key drew it: the credit meter waives the charge for a picture the
      // workspace's own key made.
      try { require('../_shared/request-scope.js').noteLlm('ok', { own: !!ownImg, kind: 'image', provider: hit.provider, model: hit.model, images: 1 }); } catch (_) { /* no scope */ }
      const usedFreeFallback = hit.provider === 'pollinations' && hadKeys && !freeFirst;
      return res.status(200).json({
        ok: true, provider: hit.provider, model: hit.model, size, quality,
        image_data_url: hit.image_data_url,
        ...(hit.image_url ? { image_url: hit.image_url } : {}),
        ...(hit.key_index ? { key_index: hit.key_index } : {}),
        ...(attempts.length ? { attempts, fell_back: true } : {}),
        ...(usedFreeFallback ? {
          quota_warning: true,
          quota_note: 'Paid image providers unavailable this call. Using Pollinations ' + hit.model + ' (free). Check Gemini/OpenAI API credits.'
        } : {})
      });
    }
    if (budgetOut) break;
  }

  // Every provider failed. Do NOT 502: the response carries the on-brand panel
  // so a page has something intentional to show. But it is NOT an image of
  // anything and is never reported as one (2026-10-11): `ok:false`,
  // `image_data_url:null`, the panel under `placeholder_data_url`. It used to be
  // `ok:true` with the panel AS image_data_url, so the Mailer Studio put it in
  // the email as the "generated hero photo" and the in-process creative
  // generators shipped it as the creative instead of falling back to the
  // brand's real catalogue photograph. The credit hold is released (metering's
  // successIf below), and the reason names every provider tried.
  const noKeys = !hadKeys;
  const tried = attempts.map((a) => a.provider + ' ' + a.model + ': ' + a.reason + (a.status > 0 ? ' (HTTP ' + a.status + ')' : '')).join('; ');
  console.warn('[image] All providers failed — returning labelled placeholder. ' + tried);
  return res.status(200).json({
    ok: false, provider: 'placeholder', placeholder: true, size, quality,
    image_data_url: null,
    placeholder_data_url: brandPlaceholderDataUri(size),
    quota_warning: hadKeys && anyQuotaHit,
    attempts,
    ...(budgetOut ? { budget_exhausted: true } : {}),
    detail: (noKeys
      ? 'No image provider key configured. Add OPENAI_API_KEY (verified org + image credits) and/or GEMINI_API_KEY in Vercel. No image was generated and nothing was charged.'
      : 'No image was generated and nothing was charged. Every image provider failed' + (budgetOut ? ' or the time budget ran out' : '') + ': ' + (tried || 'none answered') + '.')
  });
};

// ── Metering (Universal Brand Platform) ────────────────────────────────────
// Image generation is the second most expensive call in the app, so it must be
// charged. 'reels' mode is a distinct, pricier product in the catalog.
const _credits = require('../_shared/credits-core.js');
const _unmeteredCore = module.exports;
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

// In-process, for server code that has ALREADY gated and metered its own call
// (api/ai/pipeline/images.js charges `image.generate` once per call): the same
// cascade without a second hold per slot. Not an HTTP route; the request it
// is handed must carry `__admitted` and the verified `__caller` (see the gate).
module.exports.inProcess = _unmeteredCore;
