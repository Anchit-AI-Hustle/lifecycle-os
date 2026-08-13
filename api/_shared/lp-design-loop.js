'use strict';
// ════════════════════════════════════════════════════════════════════════════
// Landing-page DESIGN loop — bounded critique then revise pass on generated HTML.
//
// landing-page-core.js is single-shot: one LLM call produces the whole page.
// That is fine for correctness and weak for craft, because nothing ever looks
// at the result. This adds the second pass, without ever putting the base path
// at risk:
//
//   1. Score the generated HTML on six DESIGN dimensions (fast tier, cheap).
//   2. If the overall is below PASS, make ONE revision call (premium tier) that
//      returns the COMPLETE improved document with the concrete fixes embedded.
//   3. Budget-aware and hard time-boxed. On ANY error, timeout, truncation or
//      invalid revision it returns the ORIGINAL html untouched, so the caller's
//      request always succeeds with a valid page.
//
// BRAND RULES COME FROM THE BRAND, NOT FROM THIS FILE. The obvious way to write
// a design auditor is to name the four brand colours in the system prompt. That
// is what the sibling implementation does, and it silently makes the loop a
// tenant-zero auditor: pointed at another brand's page it would score correct
// work as a brand violation and then "fix" the page INTO the wrong palette. So
// both prompts are built from brandRuntime.brandBlock(brand), which is the same
// block the generator itself was given. The auditor and the generator therefore
// agree on what compliance means for whoever is actually running.
//
// Usage:
//   const { runDesignLoop } = require('./lp-design-loop.js');
//   const { html, quality } = await runDesignLoop({ html, brand, brief, market, store, channel, timeBoxMs });
//   // quality: { scored:bool, score:number|null, revised:bool, dims:object|null }
//
// NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
// ════════════════════════════════════════════════════════════════════════════

const callLLM = require('./llm.js');
const { parseJSON } = require('./llm.js');
const brandRuntime = require('./brand-runtime.js');

const PASS_THRESHOLD = 8;            // a "make it better" bar, higher than the mailer loop's 7
const MIN_REVISE_BUDGET_MS = 28000;  // never start a full-document revise without this much left
const DIMENSIONS = [
  'visual_hierarchy', 'brand_compliance', 'layout_polish',
  'conversion_structure', 'hero_impact', 'mobile_responsiveness',
];

function scoreSystem(brand) {
  return `You are a senior landing-page DESIGN auditor for ${(brand && brand.name) || 'this brand'}. You are given the FULL HTML of one generated landing page. Judge only what the code actually renders. Output STRICT JSON, no markdown, no commentary.

THE BRAND YOU ARE AUDITING AGAINST (authoritative, from its own record):
${brandRuntime.brandBlock(brand)}

Score each dimension 0-10:
- visual_hierarchy: a clear focal path. One dominant hero headline and one primary call to action, a deliberate type scale, generous whitespace, sections that read in priority order. Penalise flat pages where everything competes.
- brand_compliance: ONLY the palette and the two families named in the block above. HARD FAILS, cap this dimension at 3: any colour outside that palette; any black or dark-neutral SECTION background; any dark-on-dark or light-on-light text that breaks WCAG-AA contrast; any type family not named above; any phrase from the banned list; any fabricated fact, price, rating, review count or statistic.
- layout_polish: consistent spacing rhythm, aligned grids, EQUAL-SIZE aligned parallel cards, nothing cramped or overflowing, balanced composition.
- conversion_structure: announcement when an offer exists, then header, hero with one dominant call to action, trust strip, benefits, story, the offer block, an interactive section, social proof, FAQ, final call to action, footer, sticky mobile call to action. Score how complete and well-ordered this is.
- hero_impact: an above-the-fold that stops the scroll. A real stage, a promise-led headline, an immediate call to action, no wall of text.
- mobile_responsiveness: works at 360px with no horizontal overflow, tap targets at least 44px, readable clamped type.

Return JSON exactly:
{"scores":{"visual_hierarchy":n,"brand_compliance":n,"layout_polish":n,"conversion_structure":n,"hero_impact":n,"mobile_responsiveness":n},"overall":n,"critique":"1-2 sentences on the biggest design weaknesses","fixes":["specific, actionable design fix","..."]}`;
}

function reviseSystem(brand) {
  return `You are a senior interaction designer and front-end developer for ${(brand && brand.name) || 'this brand'}. You are given the CURRENT landing-page HTML and a design auditor's concrete fixes. Return ONE complete, production-ready HTML document from <!doctype html> to </html> that KEEPS every factual detail, offer, price and link exactly as-is, but ELEVATES the design by applying the fixes.

OUTPUT CONTRACT (unchanged): one self-contained HTML document. Inline CSS and a small inline JS block only. No external libraries, CDNs, remote fonts, remote JS or frameworks. It must work by opening the file directly. No markdown fences, no commentary. HTML only.

BRAND CONSTRAINTS (authoritative, from this brand's own record):
${brandRuntime.brandBlock(brand)}

DESIGN HARD RULES, never violate: never use black or any dark-neutral colour as a SECTION background. Enforce WCAG-AA contrast, so no dark-on-dark and no light-on-light. Equal-size, aligned parallel cards. One dominant primary call to action. Mobile-first at 360px with no horizontal overflow and tap targets of at least 44px. Respect prefers-reduced-motion.

Improve hierarchy, spacing rhythm, hero impact, card alignment and the conversion section order. Do not remove sections, do not change any fact, and do not invent one. Return the full improved HTML now.`;
}

function withDeadline(promise, ms) {
  if (!(ms > 0)) return Promise.reject(new Error('deadline exceeded'));
  let timer;
  return Promise.race([
    promise,
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function computeOverall(scored) {
  if (!scored || typeof scored !== 'object') return null;
  const s = scored.scores || {};
  const vals = DIMENSIONS.map((k) => Number(s[k])).filter((v) => Number.isFinite(v));
  if (vals.length < 4) return Number.isFinite(Number(scored.overall)) ? Number(scored.overall) : null;
  // Brand compliance is a GATE, not an average member: a page in the wrong
  // palette is not redeemed by good spacing, so a hard fail there caps the
  // overall and forces the revision regardless of how the rest scored.
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const compliance = Number(s.brand_compliance);
  return Number.isFinite(compliance) && compliance <= 3 ? Math.min(avg, compliance + 1) : avg;
}

const validHtml = (h) => typeof h === 'string'
  && /<!doctype/i.test(h) && /<body/i.test(h) && /<\/html>\s*$/i.test(h.trim());

async function runDesignLoop(opts) {
  const {
    html, brand = null, brief = '', market = 'US', store = '',
    channel = 'landing', timeBoxMs = 45000, userGeminiKey = '', scrub,
  } = opts || {};

  const quality = { scored: false, score: null, revised: false, dims: null };
  const clean = (v) => {
    try {
      const once = scrub ? scrub(v) : String(v || '');
      // Whatever the caller scrubs for, the ACTIVE brand's own banned list is
      // applied on top, because the caller's scrubber is tenant zero's.
      return brand ? brandRuntime.scrubForBrand(once, brand) : once;
    } catch (_) { return String(v || ''); }
  };

  if (!validHtml(html)) return { html, quality };
  const deadline = Date.now() + timeBoxMs;
  const remaining = () => deadline - Date.now();

  try {
    // ── 1. Score (fast tier, cheap) ─────────────────────────────────────────
    const scoreOut = await withDeadline(callLLM({
      systemPrompt: scoreSystem(brand),
      userMessage: (brief ? 'BRIEF:\n' + String(brief).slice(0, 1200) + '\n\n' : '')
        + 'LANDING PAGE HTML:\n' + String(html).slice(0, 40000)
        + '\n\nScore all 6 dimensions now. Return the JSON.',
      responseFormat: { type: 'json_object' },
      maxTokens: 700, temperature: 0.15,
      timeoutMs: Math.min(20000, Math.max(1, remaining())),
      stage: 'lp-design-score', tier: 'fast', userGeminiKey,
    }), remaining());

    const scored = parseJSON(scoreOut && scoreOut.text);
    const overall = computeOverall(scored);
    if (overall === null) return { html, quality };
    quality.scored = true;
    quality.score = Math.round(overall * 10) / 10;
    quality.dims = (scored && scored.scores) || null;

    if (overall >= PASS_THRESHOLD) return { html, quality };
    if (remaining() < MIN_REVISE_BUDGET_MS) return { html, quality };

    // ── 2. ONE revision (premium tier), concrete fixes embedded ─────────────
    const fixes = Array.isArray(scored.fixes)
      ? scored.fixes.slice(0, 8).map((f) => '- ' + String(f)).join('\n')
      : '';

    const reviseOut = await withDeadline(callLLM({
      systemPrompt: reviseSystem(brand),
      userMessage: 'AUDITOR SCORES: ' + JSON.stringify(scored.scores || {})
        + ' (overall ' + quality.score + '/10, pass ' + PASS_THRESHOLD + ')\n'
        + 'AUDITOR CRITIQUE: ' + String(scored.critique || '').slice(0, 600) + '\n'
        + (fixes ? 'FIXES TO APPLY:\n' + fixes + '\n' : '')
        + 'MARKET: ' + market + (store ? ' · store base ' + store : '') + ' · channel ' + channel + '\n\n'
        + 'CURRENT HTML:\n' + String(html).slice(0, 60000)
        + '\n\nReturn the complete improved HTML now.',
      temperature: 0.5, maxTokens: 8000,
      timeoutMs: Math.max(1, remaining() - 1500),
      stage: 'lp-design-revise', tier: 'premium', userGeminiKey,
    }), remaining());

    let revised = clean(reviseOut && reviseOut.text);
    revised = String(revised).replace(/^\s*```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();

    // Guard against truncation and garbage: a revision must be a full document
    // AND not drastically shorter than what it replaces. A model that runs out
    // of tokens mid-page returns something that parses but has lost sections,
    // and silently shipping that is worse than shipping the unpolished original.
    if (validHtml(revised) && revised.length >= Math.floor(String(html).length * 0.6)) {
      quality.revised = true;
      return { html: revised, quality };
    }
    return { html, quality };
  } catch (e) {
    console.warn('[lp-design-loop] skipped: ' + String((e && e.message) || e).slice(0, 160));
    return { html, quality };
  }
}

module.exports = { runDesignLoop, PASS_THRESHOLD, computeOverall, DIMENSIONS };
