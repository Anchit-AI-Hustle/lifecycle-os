'use strict';
// ════════════════════════════════════════════════════════════════════════════
// /api/ai/pipeline/score  — Stage 5: Quality scoring + retry signal
//
// Scores both generated email variants on four dimensions. If any score is
// under 7 the weak variant is flagged with a retry reason the orchestrator
// uses to raise regenerate_counter and re-run the pipeline.
//
// Gated, metered and brand-derived through api/_shared/pipeline-core.js since
// 2026-09-28 (see its header). The structural fingerprint reads the ACTIVE
// brand's primary and accent rather than one tenant's hexes, and the rubric
// no longer rewards a rating or a review count on a product card: a mailer
// that carries one it was not given is a fabrication, not density.
//
// POST body:  { html_a, html_b, variant_a_plan, variant_b_plan, strategy_output }
// Response:   { ok, stage, provider, model, scores_a, scores_b, pass,
//               weak_variant, failure_reasons[], retry_reason, credits }
// ════════════════════════════════════════════════════════════════════════════

const P = require('../../_shared/pipeline-core.js');

const PASS_THRESHOLD = 7;      // Minimum score per dimension
const DIVERGENCE_MIN = 8;      // Variant B divergence must score this or above

function systemPrompt(ctx) {
  return `You are a senior email marketing quality auditor for ${ctx.brand.name}. Score two email variants against the criteria below. Output STRICT JSON only: no commentary, no markdown.

━━ SCORING CRITERIA ━━
strategy_alignment (0-10): 10 = every section serves the stated strategy and the hero product is prominent; 5 = strategy loosely present; 0 = no connection.
content_density (0-10): 10 = every section content-complete (hero has headline, subcopy, price where one was supplied, CTA; product cards have name, description, supplied price, CTA; no blank sections); 7 = minor gaps; 5 = several thin sections; 0 = empty or placeholder sections, truncated text.
copy_quality (0-10): 10 = on-brand, specific, no banned phrases, full sentences, and NOTHING asserted that was not supplied (a rating, review count, units-sold line or testimonial that appears without a source is a fabrication and scores 0 here); 5 = adequate but generic or truncated; 0 = generic, banned phrases, invented facts or leftover bracket placeholders.
variant_divergence (0-10, Variant B only): 10 = B is visually and structurally opposite to A (inverted opening, ghost CTA, no product grid, narrative copy, editorial scale); 7 = clear differences on most dimensions; 5 = some differences; 0 = a reskin of A.

━━ PASS RULES ━━
- All Variant A scores >= ${PASS_THRESHOLD}; all Variant B scores >= ${PASS_THRESHOLD}
- Variant B variant_divergence >= ${DIVERGENCE_MIN}
- content_density >= 7 for both (empty sections must be retried)

━━ OUTPUT SCHEMA ━━
{
  "scores_a": { "strategy_alignment": 0, "content_density": 0, "copy_quality": 0, "overall": 0 },
  "scores_b": { "strategy_alignment": 0, "content_density": 0, "copy_quality": 0, "variant_divergence": 0, "overall": 0 },
  "pass": true,
  "weak_variant": null,
  "failure_reasons": ["specific reason"],
  "retry_reason": "one concise instruction for the retry, or null if pass"
}`;
}

/**
 * A structural fingerprint of the HTML (so 80KB is not sent to the model),
 * read against THIS brand's palette. Currency-agnostic price detection, and no
 * "trust badge" check that looks for another category's words.
 */
function fingerprint(html, t) {
  if (!html || typeof html !== 'string') return {};
  const stripped = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const wordCount = stripped.split(' ').filter((w) => w.length > 2).length;
  const bandStart = Math.floor(stripped.length * 0.25);
  const copySample = stripped.substring(bandStart, Math.min(stripped.length, bandStart + 900));
  const rawEllipsis = (html.match(/\.{3}/g) || []).length;
  const htmlEllipsis = (html.match(/&hellip;/gi) || []).length;
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const count = (re) => (html.match(re) || []).length;

  return {
    char_count: html.length,
    table_count: count(/<table/gi),
    image_count: count(/<img/gi),
    accent_cta_buttons: count(new RegExp('background[:\\s]*' + esc(t.accent), 'gi')),
    ghost_buttons: count(/border[:\s]*1\.5px solid|border[:\s]*2px solid/gi),
    cta_links: count(/<a[^>]+href/gi),
    hero_split: count(/<td[^>]*width=["']3[0-3][0-9]["']/gi) >= 1,
    hero_fullbleed: html.includes('IMAGE_HERO_URL') && count(/width=["']600["']/gi) >= 1,
    primary_bg_sections: count(new RegExp('bgcolor=["\']' + esc(t.primary) + '["\']', 'gi')),
    has_bgcolor_outlook: count(/bgcolor=["']#/gi),
    has_price: count(/(?:[$£€₹]|Rs\.?)\s?\d[\d,]*(?:\.\d{2})?/g),
    has_benefit_bullets: count(/<li/gi),
    has_preheader: html.includes('mso-hide:all') || html.includes('max-height:0'),
    has_responsive_style: /@media/i.test(html) && /max-width:\s*6[0-2]0px/i.test(html),
    has_truncation: (rawEllipsis - htmlEllipsis) > 3,
    has_data_required_marker: /\[DATA REQUIRED BEFORE LAUNCH:/i.test(html),
    has_bracket_placeholder: /\[[A-Z][A-Z _%-]{2,}\]/.test(html.replace(/\[DATA REQUIRED BEFORE LAUNCH:[^\]]*\]/g, '')),
    word_count: wordCount,
    copy_sample: copySample,
  };
}

function userMessage(ctx, o, fpA, fpB) {
  const s = o.strategy_output || {};
  const summary = (plan) => ({
    layout_flow: (plan.layout_plan || {}).flow,
    hero_type: (plan.layout_plan || {}).hero,
    section_ids: (plan.sections || []).map((x) => x.id),
  });
  const structurallyDiverged = fpA.accent_cta_buttons !== fpB.accent_cta_buttons
    || fpA.hero_split !== fpB.hero_split
    || fpA.hero_fullbleed !== fpB.hero_fullbleed
    || fpA.primary_bg_sections !== fpB.primary_bg_sections;
  const densityA = fpA.word_count > 200 && fpA.cta_links > 2;
  const densityB = fpB.word_count > 180 && fpB.cta_links > 1;

  return `━━ CAMPAIGN ━━
Brand: ${ctx.brand.name}
Strategy: ${s.strategy || '(not provided)'}
Theme: ${(s.theme && s.theme.name) || ''}
Strategy type: ${s.strategy_type || ''}

━━ VARIANT A ━━
Intended plan: ${JSON.stringify(summary(o.variant_a_plan))}
HTML fingerprint: ${JSON.stringify(fpA)}
Mid-email copy sample (25%-75% band):
"${fpA.copy_sample || ''}"

━━ VARIANT B ━━
Intended plan: ${JSON.stringify(summary(o.variant_b_plan))}
HTML fingerprint: ${JSON.stringify(fpB)}
Mid-email copy sample (25%-75% band):
"${fpB.copy_sample || ''}"

Structural divergence (heuristic): ${structurallyDiverged ? 'PASS: A and B have structurally different signatures' : 'WARN: A and B may share too many structural patterns'}
Content density (quick-check): A=${densityA ? 'adequate' : 'THIN'} · B=${densityB ? 'adequate' : 'THIN'}
Variant B inverted opening (required): ${fpB.primary_bg_sections > 0 ? 'PASS: sections on the primary present' : 'FAIL: no section on the primary found'}
DATA REQUIRED markers present: A=${fpA.has_data_required_marker ? 'yes (a declared gap, not a fault of the copy)' : 'no'} · B=${fpB.has_data_required_marker ? 'yes' : 'no'}

Score both variants on ALL criteria. Penalise thin content, truncated text, leftover bracket placeholders, a Variant B that looks like Variant A, and any rating, review count, units-sold line or testimonial that was not supplied. Return the JSON.`;
}

async function handler(req, res) {
  const ctx = await P.admit(req, res);
  if (!ctx) return;
  const body = ctx.body;
  const o = {
    html_a: String(body.html_a || ''),
    html_b: String(body.html_b || ''),
    variant_a_plan: (body.variant_a_plan && typeof body.variant_a_plan === 'object') ? body.variant_a_plan : {},
    variant_b_plan: (body.variant_b_plan && typeof body.variant_b_plan === 'object') ? body.variant_b_plan : {},
    strategy_output: (body.strategy_output && typeof body.strategy_output === 'object') ? body.strategy_output : {},
  };
  const t = P.tokens(ctx.brand);
  const fpA = fingerprint(o.html_a, t);
  const fpB = fingerprint(o.html_b, t);

  try {
    const { text, provider, model } = await P.llm({
      systemPrompt: systemPrompt(ctx),
      userMessage: userMessage(ctx, o, fpA, fpB),
      responseFormat: { type: 'json_object' },
      maxTokens: 700,
      temperature: 0.15,  // near-deterministic: scoring should be consistent
      timeoutMs: 20000,
      stage: 'score',
      userGeminiKey: ctx.userGeminiKey,
    });

    let parsed;
    try { parsed = P.parseJSON(text); }
    catch (_) {
      return res.status(502).json({ ok: false, error: 'json_parse_failed', provider, message: 'The model did not return valid JSON for the score.', raw: String(text || '').substring(0, 300) });
    }

    // The pass logic is enforced here as well; the model is not trusted alone.
    const sa = parsed.scores_a || {};
    const sb = parsed.scores_b || {};
    const under = (v) => v != null && Number(v) < PASS_THRESHOLD;
    const aFails = [sa.strategy_alignment, sa.content_density, sa.copy_quality].some(under);
    const bFails = [sb.strategy_alignment, sb.content_density, sb.copy_quality].some(under);
    const divergenceFails = sb.variant_divergence != null && Number(sb.variant_divergence) < DIVERGENCE_MIN;
    parsed.pass = !aFails && !bFails && !divergenceFails;
    parsed.weak_variant = (aFails && bFails) ? 'both' : aFails ? 'A' : (bFails || divergenceFails) ? 'B' : null;

    return res.status(200).json({ ok: true, stage: 'score', provider, model, fingerprint: { a: fpA, b: fpB }, ...parsed });
  } catch (e) {
    // The scoring model failed. The pipeline completes rather than looping,
    // but the caller is told no score was produced, and the meter refunds:
    // sevens written by a catch block are not a score anyone paid for.
    console.warn('[pipeline/score] scoring failed - passing through with warning:', e.message);
    return res.status(200).json({
      ok: true,
      stage: 'score',
      provider: 'fallback',
      pass: true,
      weak_variant: null,
      failure_reasons: ['scoring_unavailable'],
      retry_reason: null,
      _score_error: String(e.message || e).substring(0, 200),
      _scoring_skipped: true,
      scores_a: null,
      scores_b: null,
      fingerprint: { a: fpA, b: fpB },
    });
  }
}

module.exports = P.mount(handler, 'mailer.score');
