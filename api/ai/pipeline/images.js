'use strict';
// ════════════════════════════════════════════════════════════════════════════
// /api/ai/pipeline/images  — Stage 3: Multi-image generation with retry
//
// Generates up to 3 images per call (hero + product + lifestyle). Each image
// is retried up to 3 times if generation or validation fails.
//
// ONE CASCADE (2026-10-17). This stage used to call OpenAI and then
// Pollinations itself: a second copy of the provider waterfall that ignored
// Gemini, Cloudflare and FREE_GENERATION. It now runs the shared cascade,
// api/ai/image.js in-process through creative-image.generateCreativeImage, as
// THIS caller (so the picture is this caller's brand) and unmetered there,
// because this stage already holds `image.generate` for the call. With no key
// at all the free keyless model (Pollinations) still draws the picture;
// FREE_GENERATION=off removes that rung and a slot degrades to the placeholder.
//
// Gated, metered and brand-derived through api/_shared/pipeline-core.js since
// 2026-09-28 (see its header). The photographic preamble names the ACTIVE
// brand, and the on-brand placeholder a failed slot degrades to is painted in
// THAT brand's palette with THAT brand's name - it used to be tenant zero's
// panel in every workspace.
//
// WHAT THIS STAGE RETURNS. `url` is where the image LIVES (creative-image
// .hostedUrl: the Storage copy when storage answers, else the free generator's
// own address), and `data_url` is that same URL whenever there is one. Only a
// picture with nowhere to live (a keyed provider's bytes, no storage) comes
// back as a base64 data URL, for review only: asset-contracts.js BLOCKS a
// mailer that embeds base64 (Gmail clips past ~102KB). `hosting_note` says so.
//
// METERING. `image.generate` is a flat charge per CALL, which is what the
// catalog declares (one image through the cascade); a call that asks for
// three slots is under-charged by design until that entry becomes metered
// per unit - a pricing decision this file does not take. A call in which no
// slot succeeded is refunded (successIf), the same rule image.js applies.
//
// POST body:  { requirements: [{slot, prompt, size, negative_prompt}],
//               variant, image_style_lock }
// Response:   { ok, stage, variant, provider, images: [{slot, data_url, url,
//               success, placeholder, attempts, error, provider, prompt_used}],
//               success_count, all_success, hosting_note, credits }
// ════════════════════════════════════════════════════════════════════════════

const P = require('../../_shared/pipeline-core.js');
const { brandPlaceholderDataUri } = require('../../_shared/brand-placeholder.js');

const creative = require('../../_shared/creative-image.js');

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

// A real image: an https address the cascade vouched for (it fetched it and
// read image bytes), or a data URL that is not an error tile.
function validateImage(img) {
  if (!img || typeof img !== 'string') return { valid: false, reason: 'null or non-string' };
  if (/^https:\/\//i.test(img)) return { valid: true };
  if (!img.startsWith('data:image/')) return { valid: false, reason: 'not an image URL' };
  const base64 = img.split(',')[1] || '';
  if (base64.length < 2000) return { valid: false, reason: 'data too small - likely an error image' };
  return { valid: true };
}

// llm.js owns the switch; read the same env var if a stand-in llm.js lacks it.
function freeOn() {
  try {
    const fn = require('../../_shared/llm.js').freeGenerationOn;
    if (typeof fn === 'function') return fn();
  } catch (_) { /* fall through */ }
  return String(process.env.FREE_GENERATION || '').toLowerCase() !== 'off';
}

const HOSTING_NOTE = 'url is where each image lives; place it in the mailer. A data_url that is still base64 had nowhere to be hosted and is for review only: upload it (creative-image.js) first, because a mailer that embeds base64 is blocked by its contract.';

async function handler(req, res) {
  const ctx = await P.admit(req, res);
  if (!ctx) return;
  const body = ctx.body;

  const requirements = Array.isArray(body.requirements) ? body.requirements : [];
  const variant = String(body.variant || 'A');
  const imageStyleLock = String(body.image_style_lock || '');
  const preamble = photoPreamble(ctx.brand);
  const placeholderBrand = { name: ctx.brand.name, palette: ctx.brand.palette };
  const MAX_RETRIES = 3;
  const free = freeOn();
  // The caller this stage admitted: the cascade runs as them, so the picture is
  // their brand's, and unmetered there because this call already holds credits.
  const admitted = req.__caller && req.__caller.ok
    ? { caller: req.__caller, headers: { authorization: (req.headers && (req.headers.authorization || req.headers.Authorization)) || '' } }
    : null;
  // One deadline for the whole stage, shared by every attempt of every slot.
  const deadline = Date.now() + 100000;

  const imagePromises = requirements.slice(0, 3).map(async (item) => {
    const { slot, prompt = '', size = '1024x1024', negative_prompt = '' } = item || {};
    const fullPrompt = [imageStyleLock, prompt, negative_prompt ? 'Avoid: ' + negative_prompt : ''].filter(Boolean).join(' ').trim();
    const safeSize = VALID_SIZES.includes(size) ? size : '1024x1024';

    let image = null;
    let provider = null;
    let attempts = 0;
    let lastError = null;

    while (attempts < MAX_RETRIES) {
      const left = deadline - Date.now();
      if (left < 6000) { lastError = lastError || 'time budget spent'; break; }
      attempts++;
      try {
        const report = {};
        const gen = await creative.generateCreativeImage(preamble + fullPrompt, {
          size: safeSize, admitted, free, report,
          budgetMs: Math.min(55000, Math.floor(left / (MAX_RETRIES - attempts + 1))),
        });
        if (!gen) {
          const tried = (report.attempts || []).map((a) => a.provider + ' ' + a.status).join(', ');
          lastError = (report.detail || 'no image provider answered') + (tried ? ' [' + tried + ']' : '');
          console.warn('[pipeline/images]', variant, slot, 'attempt', attempts, '- no image:', lastError.slice(0, 200));
          continue;
        }
        const where = await creative.hostedUrl(gen, 'pipeline-' + variant + '-' + slot).catch(() => null);
        const candidate = where || gen.image;
        const validation = validateImage(candidate);
        if (validation.valid) { image = candidate; provider = gen.provider || null; break; }
        lastError = 'Validation: ' + validation.reason;
        console.warn('[pipeline/images]', variant, slot, 'attempt', attempts, '- validation failed:', lastError);
      } catch (e) {
        lastError = String(e.message || e).substring(0, 200);
        console.warn('[pipeline/images]', variant, slot, 'attempt', attempts, '- error:', lastError);
      }
    }

    // Never a null data_url: a missing image renders as a broken tile. A slot
    // that failed carries THIS brand's placeholder panel, and `success` stays
    // false so success_count, all_success and the refund stay honest.
    return {
      slot,
      data_url: image || brandPlaceholderDataUri(safeSize, '', placeholderBrand),
      url: image && /^https:\/\//i.test(image) ? image : null,
      success: !!image,
      placeholder: !image,
      provider,
      attempts,
      error: image ? null : String(lastError || '').substring(0, 400),
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
    // The providers that actually drew this call's images, not a guess from the keys.
    provider: [...new Set(images.filter((i) => i.success && i.provider).map((i) => i.provider))].join('+') || null,
    images,
    success_count: successCount,
    all_success: successCount === images.length,
    // The meter reads this: a call that produced no image is refunded.
    placeholder: images.length > 0 && successCount === 0,
    hosting_note: HOSTING_NOTE,
  });
}

module.exports = P.mount(handler, 'image.generate');
