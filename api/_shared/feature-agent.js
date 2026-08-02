'use strict';

/**
 * feature-agent.js  (cap-free _shared module — adds ZERO serverless functions)
 *
 * A single reusable agentic backbone so every feature gets agentic behavior from
 * a CONFIG (role + rubric) instead of re-implementing the same critique/analyze
 * loops. Generalizes the three patterns already in the codebase:
 *   - critique -> revise      (api/_shared/quality-loop.js — was /studio-only)
 *   - analyze -> hypothesize  (api/_shared/output-reasoning.js grounding)
 *   - evidence contract       (api/_shared/brand-llm.js system-prompt block)
 *
 * Two profiles:
 *   analyst — read-only. Turns already-computed metrics into grounded insights,
 *             ranked hypotheses, and expected impact. Every claim must quote a
 *             figure that appears in the inputs (no invented numbers).
 *   critic  — scores content against a passed rubric and, if below threshold,
 *             runs ONE bounded revision. Generalizes runQualityLoop for ads,
 *             landing pages, and lifecycle mailers.
 *
 * Everything is hard time-boxed and fails soft: on any timeout / provider error /
 * parse failure it returns the input unchanged (critic) or an empty insight set
 * (analyst), so a caller's request never fails because the agent did.
 *
 * All model calls go through the shared 6-provider llm.js cascade.
 */

const callLLM = require('./llm.js');
const { parseJSON } = require('./llm.js');

const DEFAULT_TIME_BOX_MS = 25000;

// Evidence contract shared by every role — the single rule that makes the output
// trustworthy: ground every statement in a quoted input figure.
const EVIDENCE_CONTRACT =
  'EVIDENCE CONTRACT (non-negotiable): quote the exact figure from the inputs behind every claim; ' +
  'never invent numbers, products, prices, reviews, or benchmarks; if the inputs do not support a ' +
  'point, do not make it. Respect KNICKGASM brand voice (warm, sensory, heritage) and never use the ' +
  'banned phrases (streetwear journey, transform, liquid lava, game-changer, LIMITED TIME in caps, ' +
  'hurry, don\'t miss out, last chance, while supplies last) or em/en dashes.';

function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('feature_agent_timeout')), Math.max(1, ms));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function textOf(out) {
  if (!out) return '';
  return typeof out === 'string' ? out : (out.text || '');
}

function _num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// ────────────────────────────────────────────────────────── analyst profile
async function runAnalyst({ feature = 'analytics', question = '', inputs = {}, caveats = [],
  tier = 'standard', timeBoxMs = DEFAULT_TIME_BOX_MS, userGeminiKey = '', maxInsights = 5 } = {}) {
  const result = { role: 'analyst', feature, insights: [], summary: null, grounded: false };
  const deadline = Date.now() + timeBoxMs;
  const remaining = () => deadline - Date.now();
  try {
    const sys =
      'You are a senior growth analyst for KNICKGASM (premium D2C sneaker + streetwear). You read ALREADY-COMPUTED ' +
      'metrics and produce decisions, not restated numbers. ' + EVIDENCE_CONTRACT + '\n' +
      'If a caveat says a figure is inaccurate or out-of-scope, DO NOT build a recommendation on it; ' +
      'flag it instead. Output STRICT JSON only:\n' +
      '{"insights":[{"observation":"","hypothesis":"if X then Y because Z","evidence":"quoted figure(s)",' +
      '"target_metric":"","expected_impact":"","confidence":"low|med|high"}],"summary":"2-3 sentences"}\n' +
      'Rank insights by (impact / effort). Max ' + maxInsights + ' insights.';
    const user =
      'FEATURE: ' + feature + '\n' +
      (question ? 'QUESTION: ' + question + '\n' : '') +
      'METRICS (JSON):\n' + JSON.stringify(inputs).slice(0, 14000) + '\n' +
      (caveats && caveats.length ? '\nDATA CAVEATS (do not lean on these):\n' + JSON.stringify(caveats).slice(0, 3000) : '') +
      '\n\nReturn the JSON now.';
    const out = await withDeadline(callLLM({
      systemPrompt: sys, userMessage: user, responseFormat: { type: 'json_object' },
      maxTokens: 1400, temperature: 0.3, timeoutMs: Math.max(1, remaining()),
      stage: 'feature-agent-analyst', tier, userGeminiKey, preferProvider: 'gemini+',
    }), remaining());
    const parsed = parseJSON(textOf(out));
    if (parsed && Array.isArray(parsed.insights)) {
      result.insights = parsed.insights.slice(0, maxInsights);
      result.summary = parsed.summary || null;
      result.grounded = true;
    }
    return result;
  } catch (e) {
    console.warn('[feature-agent:analyst] skipped: ' + String(e && e.message || e).slice(0, 140));
    return result;
  }
}

// ────────────────────────────────────────────────────────── critic profile
// rubric: { dimensions: [{key,label,guide}], passThreshold, reviseSystem, shapeOk(fn) }
async function runCritic({ feature = 'content', content, context = '', rubric,
  tier = 'fast', timeBoxMs = DEFAULT_TIME_BOX_MS, userGeminiKey = '' } = {}) {
  const quality = { role: 'critic', feature, scored: false, score: null, revised: false, critique: null };
  if (!content || !rubric || !Array.isArray(rubric.dimensions)) return { content, quality };
  const deadline = Date.now() + timeBoxMs;
  const remaining = () => deadline - Date.now();
  const threshold = rubric.passThreshold || 7;
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);

  try {
    const dimList = rubric.dimensions.map(d => '  ' + d.key + ' (' + d.label + '): ' + d.guide).join('\n');
    const scoreSys =
      'You are a senior quality auditor for KNICKGASM. Score the ' + feature + ' on each dimension 0-10. ' +
      EVIDENCE_CONTRACT + ' Output STRICT JSON only:\n' +
      '{"scores":{' + rubric.dimensions.map(d => '"' + d.key + '":0').join(',') + '},"overall":0,' +
      '"critique":"name the specific weakest fields and exactly what to change; quote offending copy"}\n\n' +
      'DIMENSIONS:\n' + dimList;
    const scoreOut = await withDeadline(callLLM({
      systemPrompt: scoreSys,
      userMessage: (context ? 'CONTEXT:\n' + String(context).slice(0, 1500) + '\n\n' : '') +
        (feature.toUpperCase()) + ' TO SCORE:\n' + contentStr.slice(0, 14000) + '\n\nScore now. Return JSON.',
      responseFormat: { type: 'json_object' }, maxTokens: 600, temperature: 0.15,
      timeoutMs: Math.min(20000, Math.max(1, remaining())), stage: 'feature-agent-score',
      tier, userGeminiKey,
    }), remaining());
    const scored = parseJSON(textOf(scoreOut));
    if (!scored || !scored.scores) return { content, quality };
    const dims = rubric.dimensions.map(d => _num(scored.scores[d.key])).filter(n => n !== null);
    const mean = dims.length ? dims.reduce((a, b) => a + b, 0) / dims.length : null;
    const own = _num(scored.overall);
    const overall = (own !== null && mean !== null) ? Math.min(own, mean + 2) : (own !== null ? own : mean);
    if (overall === null) return { content, quality };
    quality.scored = true;
    quality.score = Math.round(overall * 10) / 10;
    quality.critique = String(scored.critique || '').slice(0, 1200) || null;

    if (overall >= threshold || remaining() < 3000) return { content, quality };

    // ONE revision
    const reviseSys = rubric.reviseSystem ||
      ('You are the Creative Director at KNICKGASM. An auditor scored the ' + feature + ' below threshold. ' +
       'Revise it to fix EVERY point in the critique while preserving what works. ' + EVIDENCE_CONTRACT +
       ' Return the COMPLETE revised ' + feature + ' in EXACTLY the same shape/keys as the input. ' +
       'No markdown, no commentary.');
    const isJson = typeof content !== 'string';
    const reviseOut = await withDeadline(callLLM({
      systemPrompt: reviseSys,
      userMessage: 'AUDITOR SCORES: ' + JSON.stringify(scored.scores) + ' (overall ' + quality.score + '/10, pass ' + threshold + ')\n' +
        'CRITIQUE: ' + (quality.critique || 'Raise every dimension above threshold.') + '\n\n' +
        (context ? 'CONTEXT:\n' + String(context).slice(0, 1200) + '\n\n' : '') +
        'CURRENT ' + feature.toUpperCase() + ':\n' + contentStr.slice(0, 26000) +
        '\n\nReturn the complete revised ' + feature + ' now.',
      responseFormat: isJson ? { type: 'json_object' } : null, maxTokens: 6000, temperature: 0.55,
      timeoutMs: Math.max(1, remaining()), stage: 'feature-agent-revise',
      tier: 'premium', userGeminiKey,
    }), remaining());
    const revisedText = textOf(reviseOut);
    const revised = isJson ? parseJSON(revisedText) : revisedText;
    const shapeOk = rubric.shapeOk ? rubric.shapeOk(revised) : !!revised;
    if (shapeOk) { quality.revised = true; return { content: revised, quality }; }
    return { content, quality };
  } catch (e) {
    console.warn('[feature-agent:critic] skipped: ' + String(e && e.message || e).slice(0, 140));
    return { content, quality };
  }
}

/**
 * runFeatureAgent({ role, ... }) — single entry point.
 *   role: 'analyst' | 'critic'
 */
async function runFeatureAgent(opts = {}) {
  if (opts.role === 'critic') return runCritic(opts);
  return runAnalyst(opts);
}

// A few ready-made critic rubrics so feature wirings stay one-liners.
const RUBRICS = {
  ad: {
    passThreshold: 7,
    dimensions: [
      { key: 'hook_strength', label: 'hook', guide: '10 = first line stops the scroll and is specific; 0 = generic.' },
      { key: 'platform_fit', label: 'platform compliance', guide: '10 = within char limits + format for the platform; 0 = violates limits/policy.' },
      { key: 'offer_clarity', label: 'offer + CTA', guide: '10 = one clear offer and unambiguous CTA; 0 = no reason to act.' },
      { key: 'brand_safety', label: 'brand + claims', guide: '10 = on-voice, no banned phrases, no fabricated claims/discounts; 0 = violations.' },
    ],
  },
  landing_page: {
    passThreshold: 7,
    dimensions: [
      { key: 'message_match', label: 'ad-to-page match', guide: '10 = headline/offer match the driving ad/mailer; 0 = disconnected.' },
      { key: 'offer_clarity', label: 'offer clarity', guide: '10 = the promise and next step are unmistakable above the fold; 0 = buried.' },
      { key: 'proof_placement', label: 'social proof', guide: '10 = ratings/reviews/trust near the CTA; 0 = none or misplaced.' },
      { key: 'brand_safety', label: 'brand + claims', guide: '10 = on-voice, palette-safe, no fabricated claims; 0 = violations.' },
    ],
  },
};

module.exports = { runFeatureAgent, runAnalyst, runCritic, RUBRICS, EVIDENCE_CONTRACT };
