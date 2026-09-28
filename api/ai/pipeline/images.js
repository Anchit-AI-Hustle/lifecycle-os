'use strict';
// ════════════════════════════════════════════════════════════════════════════
// /api/ai/pipeline/images  — Stage 3: Multi-image generation with retry
//
// Generates up to 3 images per call (hero + product + lifestyle). Each image
// is retried up to 3 times if generation or validation fails. OpenAI's image
// models when a key is set, Pollinations FLUX otherwise.
//
// Gated, metered and brand-derived through api/_shared/pipeline-core.js since
// 2026-09-28 (see its header). The photographic preamble names the ACTIVE
// brand, and the on-brand placeholder a failed slot degrades to is painted in
// THAT brand's palette with THAT brand's name - it used to be tenant zero's
// panel in every workspace.
//
// WHAT THIS STAGE RETURNS, AND WHAT THE CALLER MUST DO WITH IT. The images
// come back as data URLs because that is the only form a provider hands over.
// They are NOT to be pasted into the mailer: asset-contracts.js BLOCKS a
// mailer that embeds base64 (Gmail clips past ~102KB and many clients refuse
// to render it at all). creative-image.js already uploads a data URL to
// Storage and returns the hosted URL; the client replaces IMAGE_*_URL with
// THAT, never with the payload below. `hosting_note` on the response says so.
//
// METERING. `image.generate` is a flat charge per CALL, which is what the
// catalog declares (one image through the cascade); a call that asks for
// three slots is under-charged by design until that entry becomes metered
// per unit - a pricing decision this file does not take. A call in which no
// slot succeeded is refunded (successIf), the same rule image.js applies.
//
// POST body:  { requirements: [{slot, prompt, size, negative_prompt}],
//               variant, image_style_lock }
// Response:   { ok, stage, variant, provider, images: [{slot, data_url,
//               success, placeholder, attempts, error, prompt_used}],
//               success_count, all_success, hosting_note, credits }
// ════════════════════════════════════════════════════════════════════════════

const P = require('../../_shared/pipeline-core.js');
const { brandPlaceholderDataUri } = require('../../_shared/brand-placeholder.js');

const OPENAI_BASE = 'https://api.openai.com/v1';
const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt';

// Image preamble: tight, non-negotiable constraints. Composition, mood and
// lighting all come from the caller's scene prompt. gpt-image models need
// explicit negative constraints to keep text, logos and email UI out of the
// scene.
function photoPreamble(brand) {
  return `Ultra-photorealistic lifestyle/product photograph for ${brand.name}. Style: editorial photography, cinematic shallow depth of field, gallery-print resolution.

MANDATORY CONSTRAINTS:
- Absolutely NO text, NO letters, NO words, NO logos, NO watermarks, NO brand marks
- NO email layout, NO UI frames, NO mockup frames, NO device screens
- NO stock photography look, NO artificial studio lighting
- Tactile textures visible, natural cinematic lighting only

SCENE:
`;
}

const VALID_SIZES = ['1024x1024', '1536x1024', '1024x1536'];

// Model cascade mirrors api/ai/image.js: gpt-image-2 auto-demotes WITHIN the
// provider to gpt-image-1 on model-not-found (404, or a 400 naming the model).
const IMAGE_MODELS = [...new Set([
  process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
  'gpt-image-1',
])];

async function generateImage(preamble, prompt, size, openaiKey, modelOverride) {
  const safeSize = VALID_SIZES.includes(size) ? size : '1024x1024';
  const finalPrompt = (preamble + prompt).substring(0, 4000);

  if (openaiKey) {
    const modelsToTry = modelOverride ? [modelOverride] : IMAGE_MODELS;
    let lastErr = null;
    for (const imageModel of modelsToTry) {
      const r = await fetch(OPENAI_BASE + '/images/generations', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + openaiKey },
        body: JSON.stringify({ model: imageModel, prompt: finalPrompt, n: 1, size: safeSize, quality: 'high', output_format: 'b64_json' }),
      });
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        const isModelErr = r.status === 404 || err.includes('model_not_found')
          || err.includes('does not exist') || err.includes('not supported')
          || (r.status === 400 && err.includes(imageModel));
        if (isModelErr && modelsToTry.indexOf(imageModel) < modelsToTry.length - 1) {
          console.warn('[pipeline/images] ' + imageModel + ' unavailable - trying next model');
          lastErr = new Error('OpenAI image ' + r.status + ': ' + err.substring(0, 200));
          continue;
        }
        throw new Error('OpenAI image ' + r.status + ': ' + err.substring(0, 200));
      }
      const data = await r.json();
      const entry = data.data && data.data[0];
      if (!entry) throw new Error('OpenAI: no image in response');
      if (entry.b64_json) return 'data:image/png;base64,' + entry.b64_json;
      if (entry.url) {
        const imgR = await fetch(entry.url, { cache: 'no-store' });
        const buf = await imgR.arrayBuffer();
        return 'data:image/png;base64,' + Buffer.from(buf).toString('base64');
      }
      throw new Error('OpenAI: unrecognised image response shape');
    }
    if (lastErr) throw lastErr;
    return null;
  }

  // Pollinations fallback: a random seed per call keeps outputs distinct.
  const sizeMap = { '1024x1024': { w: 1024, h: 1024 }, '1536x1024': { w: 1536, h: 1024 }, '1024x1536': { w: 1024, h: 1536 } };
  const dim = sizeMap[safeSize];
  const seed = Math.floor(Math.random() * 999999) + 1;
  const url = POLLINATIONS_BASE + '/' + encodeURIComponent(finalPrompt.substring(0, 1500))
    + '?width=' + dim.w + '&height=' + dim.h + '&seed=' + seed + '&nologo=true&model=flux&enhance=true';
  const imgR = await fetch(url, { cache: 'no-store' });
  if (!imgR.ok) throw new Error('Pollinations ' + imgR.status);
  const buf = await imgR.arrayBuffer();
  const ct = imgR.headers.get('content-type') || 'image/jpeg';
  return 'data:' + ct + ';base64,' + Buffer.from(buf).toString('base64');
}

// A data URL is a real image only if it is one and is not an error tile.
function validateDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return { valid: false, reason: 'null or non-string' };
  if (!dataUrl.startsWith('data:image/')) return { valid: false, reason: 'not a data: URL' };
  const base64 = dataUrl.split(',')[1] || '';
  if (base64.length < 2000) return { valid: false, reason: 'data too small - likely an error image' };
  return { valid: true };
}

const HOSTING_NOTE = 'data_url is the provider payload for review only. Upload it (creative-image.js) and place the HOSTED url in the mailer; a mailer that embeds base64 is blocked by its contract.';

async function handler(req, res) {
  const ctx = await P.admit(req, res);
  if (!ctx) return;
  const body = ctx.body;

  const requirements = Array.isArray(body.requirements) ? body.requirements : [];
  const variant = String(body.variant || 'A');
  const imageStyleLock = String(body.image_style_lock || '');
  const preamble = photoPreamble(ctx.brand);
  const placeholderBrand = { name: ctx.brand.name, palette: ctx.brand.palette };
  const openaiKeys = [process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY_2, process.env.OPENAI_API_KEY_3].filter(Boolean);
  const MAX_RETRIES = 3;

  const imagePromises = requirements.slice(0, 3).map(async (item) => {
    const { slot, prompt = '', size = '1024x1024', negative_prompt = '' } = item || {};
    const fullPrompt = [imageStyleLock, prompt, negative_prompt ? 'Avoid: ' + negative_prompt : ''].filter(Boolean).join(' ').trim();

    let dataUrl = null;
    let attempts = 0;
    let lastError = null;

    while (attempts < MAX_RETRIES) {
      attempts++;
      try {
        let genDataUrl = null;
        for (let ki = 0; ki < openaiKeys.length; ki++) {
          try {
            genDataUrl = await generateImage(preamble, fullPrompt, size, openaiKeys[ki]);
            break;
          } catch (e) {
            const msg = String(e.message || e);
            const isQuota = msg.includes('429') || msg.includes('402') || /quota|billing/i.test(msg);
            if (isQuota) {
              if (ki < openaiKeys.length - 1) {
                console.warn('[pipeline/images]', variant, slot, 'key', ki + 1, 'quota exhausted - rotating to key', ki + 2);
                continue;
              }
              console.warn('[pipeline/images]', variant, slot, 'all', openaiKeys.length, 'keys quota exhausted - will try Pollinations');
              break;
            }
            throw e;
          }
        }
        if (!genDataUrl) {
          if (openaiKeys.length) console.warn('[pipeline/images]', variant, slot, 'all OpenAI keys exhausted - using Pollinations fallback');
          genDataUrl = await generateImage(preamble, fullPrompt, size, null);
        }
        dataUrl = genDataUrl;
        const validation = validateDataUrl(dataUrl);
        if (validation.valid) break;
        lastError = 'Validation: ' + validation.reason;
        dataUrl = null;
        console.warn('[pipeline/images]', variant, slot, 'attempt', attempts, '- validation failed:', lastError);
      } catch (e) {
        lastError = String(e.message || e).substring(0, 200);
        dataUrl = null;
        console.warn('[pipeline/images]', variant, slot, 'attempt', attempts, '- error:', lastError);
      }
    }

    // Never a null data_url: a missing image renders as a broken tile. A slot
    // that failed carries THIS brand's placeholder panel, and `success` stays
    // false so success_count, all_success and the refund stay honest.
    return {
      slot,
      data_url: dataUrl || brandPlaceholderDataUri(size, '', placeholderBrand),
      success: !!dataUrl,
      placeholder: !dataUrl,
      attempts,
      error: dataUrl ? null : lastError,
      prompt_used: fullPrompt.substring(0, 200),
    };
  });

  const images = await Promise.allSettled(imagePromises).then((results) =>
    results.map((r) => (r.status === 'fulfilled' ? r.value : {
      slot: '?', data_url: brandPlaceholderDataUri('1024x1024', '', placeholderBrand), success: false, placeholder: true, attempts: MAX_RETRIES, error: String(r.reason),
    })));

  const successCount = images.filter((i) => i.success).length;

  return res.status(200).json({
    ok: true,
    stage: 'images',
    variant,
    provider: openaiKeys.length > 0 ? 'openai' : 'pollinations',
    images,
    success_count: successCount,
    all_success: successCount === images.length,
    // The meter reads this: a call that produced no image is refunded.
    placeholder: images.length > 0 && successCount === 0,
    hosting_note: HOSTING_NOTE,
  });
}

module.exports = P.mount(handler, 'image.generate');
