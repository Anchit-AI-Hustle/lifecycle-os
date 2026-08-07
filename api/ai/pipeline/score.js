'use strict';
// ════════════════════════════════════════════════════════════════════════════
// /api/ai/pipeline/score  — Stage 5: Quality scoring + retry signal
//
// Scores both generated email variants on 4 dimensions. If any score < 7,
// flags the weak variant and returns a retry reason the orchestrator uses
// to increase regenerate_counter and re-run the pipeline.
//
// POST body:  { html_a, html_b, variant_a_plan, variant_b_plan, strategy_output }
// Response:   { ok, scores_a, scores_b, pass, weak_variant, failure_reasons[], retry_reason }
// ════════════════════════════════════════════════════════════════════════════

const { corsHeaders, parseJSON } = require('../../_shared/llm');
const callLLM = require('../../_shared/llm');

const PASS_THRESHOLD = 7;      // Minimum score per dimension
const DIVERGENCE_MIN  = 8;     // Variant B divergence must score this or above

const SYSTEM = `You are a senior email marketing quality auditor for KNICKGASM. Score two email variants against specific quality criteria. Output STRICT JSON only — no commentary, no markdown.

━━ SCORING CRITERIA ━━

strategy_alignment (0-10):
  10 = Every section directly serves the stated campaign strategy, hero product prominent
  5  = Strategy is loosely present
  0  = No connection to strategy

content_density (0-10):
  10 = All sections content-complete: hero has bullets+price+CTA, product cards have ratings+description+price, no blank whitespace sections
  7  = Most sections filled, minor gaps
  5  = Several sections thin or padded
  0  = Multiple empty/placeholder sections or truncated text

copy_quality (0-10):
  10 = Premium, brand-aligned, emotionally specific, zero banned phrases, full sentences (no truncation)
  5  = Adequate, some generic copy or truncated text
  0  = Generic marketing copy, banned phrases, or placeholder brackets found

variant_divergence (0-10) — score ONLY for Variant B:
  10 = B is visually and structurally opposite to A: dark opening, ghost CTA, no product grid, narrative copy, editorial scale
  7  = Clear differences on most dimensions
  5  = Some differences but same general feel
  0  = B is essentially a reskin of A — same colors, same CTA style, same product-first structure

━━ PASS RULES ━━
- All Variant A scores ≥ ${PASS_THRESHOLD}
- All Variant B scores ≥ ${PASS_THRESHOLD}
- Variant B variant_divergence ≥ ${DIVERGENCE_MIN}
- content_density ≥ 7 for both variants (key quality gate — empty sections must be retried)

━━ OUTPUT SCHEMA ━━
{
  "scores_a": {
    "strategy_alignment": 0-10,
    "content_density": 0-10,
    "copy_quality": 0-10,
    "overall": 0-10
  },
  "scores_b": {
    "strategy_alignment": 0-10,
    "content_density": 0-10,
    "copy_quality": 0-10,
    "variant_divergence": 0-10,
    "overall": 0-10
  },
  "pass": true | false,
  "weak_variant": null | "A" | "B" | "both",
  "failure_reasons": ["specific reason 1", "specific reason 2"],
  "retry_reason": "1 concise instruction for what to fix on retry, OR null if pass"
}`;

// Extract a structural fingerprint from HTML (avoids sending 80KB to the LLM)
function fingerprint(html) {
  if (!html || typeof html !== 'string') return {};
  const stripped = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                       .replace(/<[^>]+>/g, ' ')
                       .replace(/\s+/g, ' ')
                       .trim();
  const wordCount = stripped.split(' ').filter(w => w.length > 2).length;

  // Sample copy from the 25%–75% band of the email (skips header boilerplate, includes product body)
  const bandStart = Math.floor(stripped.length * 0.25);
  const bandEnd   = Math.min(stripped.length, bandStart + 900);
  const copySample = stripped.substring(bandStart, bandEnd);

  // Truncation: only flag if truncation patterns appear inside quoted/headline text
  // (CSS ellipsis or HTML entities starting with &hellip; are false positives)
  const rawEllipsis = (html.match(/\.{3}/g) || []).length;
  const htmlEllipsis = (html.match(/&hellip;/gi) || []).length;
  const realEllipsis = rawEllipsis - htmlEllipsis;

  // Count distinct dark-bg sections (each opening #D0473E background counts once per <td>)
  const darkBgSections = (html.match(/bgcolor=["']#D0473E["']/gi) || []).length;

  return {
    char_count: html.length,
    table_count: (html.match(/<table/gi) || []).length,
    image_count: (html.match(/<img/gi) || []).length,
    // Conversion signals
    amber_cta_buttons: (html.match(/background[:\s]*#6A33D8/gi) || []).length,
    ghost_buttons: (html.match(/border[:\s]*1\.5px solid|border[:\s]*2px solid/gi) || []).length,
    cta_links: (html.match(/<a[^>]+href/gi) || []).length,
    // Layout signals
    hero_split: (html.match(/<td[^>]*width=["']3[0-3][0-9]["']/gi) || []).length >= 1,
    hero_fullbleed: html.includes('IMAGE_HERO_URL') && (html.match(/width=["']600["']/gi) || []).length >= 1,
    dark_bg_sections: darkBgSections,
    has_bgcolor_outlook: (html.match(/bgcolor=["']#/gi) || []).length,  // Outlook compatibility check
    // Content density signals
    has_star_rating: html.includes('4.8') || html.includes('★') || html.includes('⭐'),
    has_trust_badges: html.toLowerCase().includes('farm direct') || html.toLowerCase().includes('b-corp'),
    has_free_shipping: html.toLowerCase().includes('free ship') || html.toLowerCase().includes('free shipping'),
    has_price: (html.match(/\$\d+\.\d{2}/g) || []).length,  // count of price instances (not just boolean)
    has_benefit_bullets: (html.match(/<li/gi) || []).length,
    has_testimonial: html.includes('"') && (html.toLowerCase().includes('review') || html.toLowerCase().includes('loved') || html.toLowerCase().includes('perfect')),
    has_preheader: html.includes('mso-hide:all') || html.includes('max-height:0'),  // preheader present
    has_responsive_style: html.toLowerCase().includes('@media') && html.includes('max-width:600px'),
    // Truncation: ellipsis inside actual text content (not CSS) is a content failure signal
    has_truncation: realEllipsis > 3,
    word_count: wordCount,
    copy_sample: copySample   // mid-email band captures product content, not just header
  };
}

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const userGeminiKey = req.headers['x-user-gemini-key'] || '';

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: 'invalid_json' }); }
  }
  body = body || {};

  const { html_a = '', html_b = '', variant_a_plan = {}, variant_b_plan = {}, strategy_output = {} } = body;

  const fpA = fingerprint(html_a);
  const fpB = fingerprint(html_b);

  // Structural divergence check (heuristic, pre-LLM)
  const structurallyDiverged = fpA.amber_cta_buttons !== fpB.amber_cta_buttons ||
                               fpA.hero_split !== fpB.hero_split ||
                               fpA.hero_fullbleed !== fpB.hero_fullbleed ||
                               fpA.dark_bg_sections !== fpB.dark_bg_sections;

  // Content density quick-check
  const densityA = fpA.word_count > 200 && fpA.has_price && fpA.cta_links > 2;
  const densityB = fpB.word_count > 180 && fpB.cta_links > 1;

  const planSummaryA = {
    layout_flow: (variant_a_plan.layout_plan || {}).flow,
    hero_type: (variant_a_plan.layout_plan || {}).hero,
    section_ids: (variant_a_plan.sections || []).map(s => s.id)
  };
  const planSummaryB = {
    layout_flow: (variant_b_plan.layout_plan || {}).flow,
    hero_type: (variant_b_plan.layout_plan || {}).hero,
    section_ids: (variant_b_plan.sections || []).map(s => s.id)
  };

  const userMessage = `━━ CAMPAIGN ━━
Strategy: ${strategy_output.strategy || '(not provided)'}
Theme: ${(strategy_output.theme && strategy_output.theme.name) || ''}
Strategy type: ${strategy_output.strategy_type || ''}

━━ VARIANT A ━━
Intended plan: ${JSON.stringify(planSummaryA)}
HTML fingerprint: ${JSON.stringify(fpA)}
Content signals: word_count=${fpA.word_count} | prices_found=${fpA.has_price} | has_ratings=${fpA.has_star_rating} | bullet_count=${fpA.has_benefit_bullets} | has_trust=${fpA.has_trust_badges} | cta_count=${fpA.cta_links} | truncation_detected=${fpA.has_truncation} | outlook_bgcolor_count=${fpA.has_bgcolor_outlook} | responsive=${fpA.has_responsive_style}
Mid-email copy sample (25%-75% band):
"${fpA.copy_sample || ''}"

━━ VARIANT B ━━
Intended plan: ${JSON.stringify(planSummaryB)}
HTML fingerprint: ${JSON.stringify(fpB)}
Content signals: word_count=${fpB.word_count} | prices_found=${fpB.has_price} | has_ratings=${fpB.has_star_rating} | bullet_count=${fpB.has_benefit_bullets} | cta_count=${fpB.cta_links} | dark_bg_sections=${fpB.dark_bg_sections} | ghost_cta=${fpB.ghost_buttons} | truncation_detected=${fpB.has_truncation} | outlook_bgcolor_count=${fpB.has_bgcolor_outlook} | responsive=${fpB.has_responsive_style}
Mid-email copy sample (25%-75% band):
"${fpB.copy_sample || ''}"

Structural divergence (heuristic): ${structurallyDiverged ? 'PASS — A and B have structurally different signatures (hero type, CTA style, dark sections)' : 'WARN — A and B may share too many structural patterns'}
Content density (quick-check): A=${densityA ? 'adequate' : 'THIN — needs retry'} · B=${densityB ? 'adequate' : 'THIN — needs retry'}
Variant B dark opening (required): ${fpB.dark_bg_sections > 0 ? 'PASS — dark sections present' : 'FAIL — no dark background sections found (B must open dark)'}

Score both variants now on ALL criteria. Penalise heavily for: thin content, missing prices, missing ratings, truncated text, or Variant B that looks like Variant A. Return the JSON.`;

  try {
    const { text, provider, model } = await callLLM({
      systemPrompt: SYSTEM,
      userMessage,
      responseFormat: { type: 'json_object' },
      maxTokens: 700,
      temperature: 0.15,  // Near-deterministic — scoring should be consistent
      timeoutMs: 20000,
      stage: 'score',
      userGeminiKey
    });

    let parsed;
    try { parsed = parseJSON(text); }
    catch (e) { return res.status(502).json({ error: 'json_parse_failed', provider, raw: text.substring(0, 300) }); }

    // Enforce pass logic client-side too (don't trust LLM alone)
    const sa = parsed.scores_a || {};
    const sb = parsed.scores_b || {};
    const aFails = [sa.strategy_alignment, sa.content_density, sa.copy_quality]
      .some(s => s != null && s < PASS_THRESHOLD);
    const bFails = [sb.strategy_alignment, sb.content_density, sb.copy_quality]
      .some(s => s != null && s < PASS_THRESHOLD);
    const divergenceFails = sb.variant_divergence != null && sb.variant_divergence < DIVERGENCE_MIN;

    parsed.pass = !aFails && !bFails && !divergenceFails;
    parsed.weak_variant = (aFails && bFails) ? 'both' : aFails ? 'A' : (bFails || divergenceFails) ? 'B' : null;

    return res.status(200).json({ ok: true, stage: 'score', provider, model, ...parsed });

  } catch (e) {
    // Scoring LLM failed — pass through so pipeline completes rather than looping,
    // but flag the error so the frontend can show a warning to the user.
    console.warn('[pipeline/score] scoring failed — passing through with warning:', e.message);
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
      scores_a: { strategy_alignment: 7, content_density: 7, copy_quality: 7, overall: 7 },
      scores_b: { strategy_alignment: 7, content_density: 7, copy_quality: 7, variant_divergence: 8, overall: 7 }
    });
  }
};
