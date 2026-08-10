'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Agentic flow — final IDEATION stage (net-new vs the normal pipeline).
// Given the run context (analysis + plan + the freshly generated campaign +
// review), propose the highest-leverage NEXT actions the team should take that
// are NOT already on the calendar. Tier-aware; degrades to a deterministic
// fallback when no LLM provider is configured.
// ─────────────────────────────────────────────────────────────────────────────

let callLLM; try { callLLM = require('./llm.js'); } catch (_) { callLLM = null; }

async function ideate({ analysis = {}, calendar = {}, review = {}, market = 'US', tier = 'budget' } = {}) {
  const ctx = {
    cohorts: (analysis.cohorts || []).map((c) => c.name || c.cohort).filter(Boolean).slice(0, 8),
    winningAngles: (analysis.winningCampaigns || analysis.winning_campaigns || []).slice(0, 5).map((c) => c.name || c.subject).filter(Boolean),
    calendarDays: calendar.days,
    entries: (calendar.entries || []).length,
    reviewScore: review.score != null ? review.score : review.pass,
  };
  if (callLLM) {
    try {
      const sys = "You are KNICKGASM's Head of Growth. Given the current analysis, plan, and a freshly generated campaign, propose the 3-5 highest-leverage NEXT actions the team should take that are NOT already on the calendar — new segments to test, untapped channels, creative experiments, retention plays, or data gaps to close. Return STRICT JSON {\"ideas\":[{\"title\",\"why\",\"action\",\"impact\":\"high|medium|low\",\"effort\":\"low|medium|high\"}]}. Be specific to the data provided; no platitudes, no banned phrases (no 'wellness journey', 'transform', 'game-changer').";
      const user = `MARKET: ${market}\nCONTEXT JSON:\n${JSON.stringify(ctx)}\n\nReturn the JSON now.`;
      const out = await callLLM({ systemPrompt: sys, userMessage: user, responseFormat: { type: 'json_object' }, maxTokens: 900, tier, stage: 'agentic-ideation' });
      const parsed = callLLM.parseJSON(typeof out === 'string' ? out : out.text);
      if (parsed && Array.isArray(parsed.ideas) && parsed.ideas.length) {
        return { ok: true, provider: out.provider || 'llm', ideas: parsed.ideas.slice(0, 5) };
      }
    } catch (_) { /* fall through */ }
  }
  return {
    ok: true, provider: 'fallback',
    ideas: [
      { title: 'Win-back lapsed buyers', why: 'A lapsed cohort is present in the analysis with no active flow.', action: 'Launch a 90-day win-back email/SMS flow with a first-reorder incentive.', impact: 'high', effort: 'medium' },
      { title: 'Quick-win bestseller spotlight', why: 'Fastest lever for immediate revenue.', action: 'Run a 48-hour bestseller spotlight to the high-intent segment.', impact: 'medium', effort: 'low' },
      { title: 'Close the attribution gap', why: 'Channel performance is uneven and partly unmeasured.', action: 'Add UTM + post-purchase survey to attribute the next 2 weeks of orders.', impact: 'medium', effort: 'low' },
    ],
  };
}

module.exports = { ideate };
