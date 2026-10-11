'use strict';
// ════════════════════════════════════════════════════════════════════════════
// Quality loop — bounded critique → revise pass for mailer_full specs.
//
// Adapts the 4-dimension scoring rubric from api/ai/pipeline/score.js
// (strategy_alignment / content_density / copy_quality / variant_divergence,
// pass threshold 7/10) to the mailer_full JSON spec that /api/ai/generate
// returns, and — unlike score.js, which is a standalone dead-code stage — runs
// IN-PROCESS on every mailer_full generation:
//
//   1. Score the spec via the shared llm.js cascade on tier 'fast'.
//   2. If overall < 7 → ONE revision call on tier 'premium' with the critique
//      embedded. Never more than one revision (Hobby 90s maxDuration).
//   3. The whole loop is hard time-boxed (default 25s). On ANY error, timeout,
//      or unparseable output it skips silently — the caller's request always
//      succeeds with the original spec.
//
// Usage:
//   const { runQualityLoop } = require('./quality-loop.js');
//   const { spec, quality } = await runQualityLoop({ spec, brief, userGeminiKey });
//   // quality: { scored: bool, score: number|null, revised: bool }
// ════════════════════════════════════════════════════════════════════════════

const callLLM = require('./llm.js');
const { parseJSON } = require('./llm.js');

const PASS_THRESHOLD = 7;   // same gate as api/ai/pipeline/score.js
const DEFAULT_TIME_BOX_MS = 25000;

// ── Scoring rubric (adapted from api/ai/pipeline/score.js for spec JSON) ─────
// Both prompts are written for the brand the mailer is FOR (2026-10-10): they
// named tenant zero, its product, its palette, its typefaces and its banned
// list for every brand's mailer, and the revision pass then rewrote another
// brand's copy towards them.
function auditFacts(brand) {
  const rt = require('./brand-runtime.js');
  let b = brand;
  try { b = rt.scopedBrand(brand, { allowTenantZero: true }); } catch (_) { b = brand || {}; }
  const f = rt.promptFacts(b);
  return {
    who: `${f.name} (${f.descriptor})`, name: f.name,
    banned: f.banned.length ? f.banned.join(', ') : 'none on file',
    preferred: f.preferred.length ? f.preferred.join(', ') : "the brand's own vocabulary",
    palette: f.palette, typography: f.typography,
  };
}
const SCORE_SYSTEM_FOR = (A) => `You are a senior email marketing quality auditor for ${A.who}. You are scoring a mailer SPEC (strategy + two variant plans + copy + image prompts, as JSON) BEFORE it is built into HTML.

━━ SCORING CRITERIA (0-10 each) ━━

strategy_alignment:
  10 = Every section of both variants directly serves the locked strategy; hero product prominent; synthesis/theme/copy all coherent
  5  = Strategy loosely present
  0  = No connection between strategy and the variant plans

content_density:
  10 = All sections content-complete: real eyebrow/headline/subcopy/cta strings, subject lines + preheader filled, 3 detailed image_requirements per variant, no empty or placeholder fields
  7  = Most fields filled, minor gaps
  5  = Several sections thin, generic, or padded
  0  = Empty/placeholder fields ("", "TBD", lorem) or missing sections

copy_quality:
  10 = Premium, brand-aligned, emotionally specific, sensory; zero banned phrases (${A.banned}) and no false urgency; concrete reason-to-act with numbers/offers
  5  = Adequate; some generic marketing copy
  0  = Generic copy, banned phrases present, or no reason-to-act anywhere

variant_divergence:
  10 = Variant B is structurally opposite to A: narrative-led opening with no product in the first sections, no product grids, understated/ghost CTA, different section order, different image scenes
  7  = Clear differences on most dimensions
  5  = Some differences but same general feel
  0  = B is a reskin of A

The answer is the JSON object the OUTPUT REQUIREMENT at the end of the request describes.`;

const REVISE_SYSTEM_FOR = (A) => `You are the Creative Director + Director of Growth at ${A.who}. A quality auditor scored the mailer spec below under the pass threshold. Revise it to fix EVERY point in the critique while preserving everything that already works.

HARD RULES:
- Return the COMPLETE revised spec as STRICT JSON with EXACTLY the same schema and top-level keys as the input (synthesis, strategy, vibe, product_logic, theme, image_style_lock, variant_a, variant_b — keep any extra keys the input has). Do not drop, rename, or add top-level keys.
- Keep product names, prices, and URLs from the input verbatim — never invent SKUs.
- Palette ONLY ${A.palette}. Typography ${A.typography}.
- BANNED: ${A.banned}.
- PREFERRED: ${A.preferred}.
- Variant B must stay structurally opposite to Variant A (narrative-led, no product grids, understated CTA).
The answer is the object the OUTPUT REQUIREMENT at the end of the request describes.`;

// What the auditor and the reviser return (output-contract.js): the OUTPUT
// REQUIREMENT each request ends with. The reviser's shape is the input spec's
// own, read off it, so "the same keys as the input" is a list, not a hope.
const OC = require('./output-contract.js');
function scoreSpec(A) {
  const s = { type: 'number', min: 0, max: 10 };
  return { id: 'quality-loop.score', kind: 'data', format: 'json', brand: A.name, missing: false,
    returns: 'ONE JSON object: the 0-10 score on each of the four criteria, the overall score, and the critique.',
    schema: { scores: { type: 'object', of: { strategy_alignment: s, content_density: s, copy_quality: s, variant_divergence: s } }, overall: s,
      critique: { type: 'string', note: '2-4 sentences naming the specific weakest fields or sections and exactly what to change, quoting the offending copy' } } };
}
function reviseSpec(A, spec) {
  return { id: 'quality-loop.revise', kind: 'data', format: 'json', brand: A.name, extraKeys: true,
    returns: 'ONE JSON object: the COMPLETE revised mailer spec, with exactly the top-level keys of the CURRENT SPEC JSON.',
    schema: OC.schemaOf(spec, 1) };
}

function _num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// Overall = LLM's overall if sane, else mean of the 4 dims (enforced
// server-side like score.js does — never trust the LLM's pass verdict alone).
function computeOverall(parsed) {
  const s = (parsed && parsed.scores) || {};
  const dims = [s.strategy_alignment, s.content_density, s.copy_quality, s.variant_divergence]
    .map(_num).filter((n) => n !== null);
  const fromDims = dims.length ? dims.reduce((a, b) => a + b, 0) / dims.length : null;
  const own = _num(parsed && parsed.overall);
  if (own !== null && fromDims !== null) return Math.min(own, fromDims + 2); // clamp inflated overalls
  return own !== null ? own : fromDims;
}

// Race a promise against the loop's remaining budget. Timer is always cleared.
function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('quality_loop_timeout')), Math.max(1, ms));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * runQualityLoop({ spec, brief, userGeminiKey, timeBoxMs })
 *   spec   — parsed mailer_full JSON (never mutated)
 *   brief  — the campaign brief/user message that produced it (context for scoring)
 * Returns { spec, quality: { scored, score, revised } } — never throws.
 */
async function runQualityLoop({ spec, brief = '', userGeminiKey = '', timeBoxMs = DEFAULT_TIME_BOX_MS, brand = null } = {}) {
  const A = auditFacts(brand);
  const SCORE_SYSTEM = SCORE_SYSTEM_FOR(A);
  const REVISE_SYSTEM = REVISE_SYSTEM_FOR(A);
  const quality = { scored: false, score: null, revised: false };
  if (!spec || typeof spec !== 'object') return { spec, quality };
  const deadline = Date.now() + timeBoxMs;
  const remaining = () => deadline - Date.now();

  try {
    // ── 1. Score (fast tier) ────────────────────────────────────────────────
    const specJson = JSON.stringify(spec);
    const scoreOut = await withDeadline(callLLM({
      systemPrompt: SCORE_SYSTEM,
      userMessage: OC.append(
        (brief ? 'CAMPAIGN CONTEXT:\n' + String(brief).slice(0, 1500) + '\n\n' : '') +
        'MAILER SPEC JSON:\n' + specJson.slice(0, 14000), scoreSpec(A)),
      responseFormat: { type: 'json_object' },
      maxTokens: 600,
      temperature: 0.15,           // near-deterministic, same as score.js
      timeoutMs: Math.min(20000, Math.max(1, remaining())),
      stage: 'quality-score',
      tier: 'fast',
      userGeminiKey,
    }), remaining());

    const scored = parseJSON(scoreOut.text);
    const overall = computeOverall(scored);
    if (overall === null) return { spec, quality };  // unusable score → skip silently
    quality.scored = true;
    quality.score = Math.round(overall * 10) / 10;

    if (overall >= PASS_THRESHOLD) return { spec, quality };
    if (remaining() < 3000) return { spec, quality }; // no realistic time for a revision

    // ── 2. ONE revision (premium tier), critique embedded ───────────────────
    const critique = String((scored && scored.critique) || 'Raise every dimension above 7.').slice(0, 1200);
    const dims = JSON.stringify((scored && scored.scores) || {});
    const reviseOut = await withDeadline(callLLM({
      systemPrompt: REVISE_SYSTEM,
      userMessage: OC.append(
        'AUDITOR SCORES: ' + dims + ' (overall ' + quality.score + '/10, pass threshold ' + PASS_THRESHOLD + ')\n' +
        'AUDITOR CRITIQUE: ' + critique + '\n\n' +
        (brief ? 'CAMPAIGN CONTEXT:\n' + String(brief).slice(0, 1200) + '\n\n' : '') +
        'CURRENT SPEC JSON:\n' + specJson.slice(0, 30000), reviseSpec(A, spec)),
      responseFormat: { type: 'json_object' },
      maxTokens: 7000,
      temperature: 0.6,
      timeoutMs: Math.max(1, remaining()),
      stage: 'quality-revise',
      tier: 'premium',
      userGeminiKey,
    }), remaining());

    const revised = parseJSON(reviseOut.text);
    // Sanity: revision must keep the mailer_full shape — else keep the original.
    if (revised && typeof revised === 'object' && revised.variant_a && revised.variant_b) {
      quality.revised = true;
      return { spec: revised, quality };
    }
    return { spec, quality };
  } catch (e) {
    // Timeout / provider failure / parse error → skip silently, never fail the request.
    console.warn('[quality-loop] skipped: ' + String(e && e.message || e).slice(0, 160));
    return { spec, quality };
  }
}

module.exports = { runQualityLoop, PASS_THRESHOLD };
