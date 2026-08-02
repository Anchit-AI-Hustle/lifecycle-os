'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Dual-mode AGENTIC flow orchestrator.
//
// The "normal" flow is the existing single-pass pipeline. The AGENTIC flow runs
// generation as 8 independent, traced stages over the SAME Smart Brain services,
// adding LLM reasoning (planning / review / ideation), the 5-scenario calendar,
// a score-gated retry on asset creation, and tier ('budget'|'maxpower') control:
//
//   data → analysis → planning → calendar(+scenarios) → content(script)
//        → asset creation → smart review → ideation
//
// Lives in _shared/ and is dispatched from brain.js ?action=agentic-run — NO new
// serverless function (repo is at the 12-function Hobby cap). Degrades gracefully
// offline: services fall back to local data, LLM stages fall back deterministically.
// ─────────────────────────────────────────────────────────────────────────────

const svc = require('../../lib/smart-brain/services.js');
const plan = require('./smart-brain-plan.js');
const { buildScenarios } = require('./calendar-scenarios.js');
const { ideate } = require('./agentic-ideation.js');
let callLLM; try { callLLM = require('./llm.js'); } catch (_) { callLLM = null; }

function trim(obj, n = 1400) {
  try { const s = JSON.stringify(obj); return s.length > n ? (s.slice(0, n) + '…') : obj; }
  catch (_) { return null; }
}

async function planningStage(analysis, market, tier) {
  if (!callLLM) return { provider: 'fallback', objective: 'Re-engage proven cohorts with bestsellers; protect margin.', cohorts: [], heroAngles: [], northStarMetric: 'revenue' };
  try {
    const sys = "You are KNICKGASM's growth strategist. Given the analysis, set the 30-day STRATEGIC LOCK. Return STRICT JSON {\"objective\",\"cohorts\":[\"..\"],\"heroAngles\":[\"..\"],\"northStarMetric\"}. No banned phrases.";
    const user = `MARKET ${market}\nANALYSIS ${JSON.stringify({ cohorts: (analysis.cohorts || []).slice(0, 8), winners: (analysis.winningCampaigns || analysis.winning_campaigns || []).slice(0, 5) })}\nReturn JSON.`;
    const out = await callLLM({ systemPrompt: sys, userMessage: user, responseFormat: { type: 'json_object' }, maxTokens: 700, tier, stage: 'agentic-planning' });
    return Object.assign({ provider: out.provider || 'llm' }, callLLM.parseJSON(typeof out === 'string' ? out : out.text));
  } catch (_) { return { provider: 'fallback', objective: 'fallback strategy', cohorts: [], heroAngles: [] }; }
}

async function reviewStage(campaign, tier) {
  if (!callLLM) return { provider: 'fallback', score: 7, pass: true, weak_points: [], retry_reason: '' };
  try {
    const sys = "You are a strict brand-QA reviewer for KNICKGASM. Score the generated campaign 0-10 on brand-voice fit, clarity, conversion strength, and absence of banned phrases. Return STRICT JSON {\"score\":0-10,\"pass\":boolean,\"weak_points\":[\"..\"],\"retry_reason\":\"\"}. pass=true only if score>=7.";
    const out = await callLLM({ systemPrompt: sys, userMessage: `CAMPAIGN ${JSON.stringify(campaign).slice(0, 3000)}\nReturn JSON.`, responseFormat: { type: 'json_object' }, maxTokens: 500, tier, stage: 'agentic-review' });
    const p = callLLM.parseJSON(typeof out === 'string' ? out : out.text);
    p.provider = out.provider || 'llm';
    if (typeof p.pass !== 'boolean') p.pass = Number(p.score) >= 7;
    return p;
  } catch (_) { return { provider: 'fallback', score: 7, pass: true }; }
}

/**
 * runAgentic(opts) → { ok, mode, tier, market, stages[], strategy, scenarios, campaign, review, ideation }
 *   opts: { market, brief, tier:'budget'|'maxpower', days, scope, withCreatives, maxRetries }
 */
async function runAgentic(opts = {}) {
  const { market = 'US', tier = 'budget', days, maxRetries = 1 } = opts;
  const withCreatives = opts.withCreatives != null ? opts.withCreatives : (tier === 'maxpower');
  const config = svc.smartConfig();
  const stages = [];
  const rec = (stage, ok, summary, artifact) => stages.push({ stage, ok, summary, artifact: artifact !== undefined ? trim(artifact) : null });

  // 1. DATA
  const db = new svc.SmartBrainDbAdapter(config);
  let ownData, competitorData;
  try {
    ownData = await db.ownData();
    competitorData = await db.competitorData();
    rec('data', true, `${db.connected ? 'db-linked' : 'local-fallback'} — ${(ownData.campaigns || []).length} campaigns, ${(ownData.users || []).length} users`, { mode: db.connected ? 'db' : 'local' });
  } catch (e) { rec('data', false, String(e && e.message || e)); return { ok: false, stages }; }

  // 2. ANALYSIS
  const kb = new svc.KnowledgeBaseService(config).build(ownData);
  const analysis = new svc.AnalysisService(config).analyze(kb, ownData);
  const competitorBenchmarks = new svc.CompetitorBenchmarkingService(config).benchmark(competitorData);
  rec('analysis', true, `${(analysis.cohorts || []).length} cohorts, ${(analysis.winningCampaigns || analysis.winning_campaigns || []).length} winning campaigns`, { cohorts: (analysis.cohorts || []).map((c) => c.name || c.cohort) });

  // 3. PLANNING (LLM, tier-aware)
  const strategy = await planningStage(analysis, market, tier);
  rec('planning', true, strategy.objective || 'strategy set', strategy);

  // 4. CALENDAR (+ 5 scenarios)
  const calendar = new svc.CalendarIntelligenceService(config).generate({ analysis, competitorBenchmarks, days: days || config.calendarDays, feedback: ownData.feedback });
  const scenarioSet = await buildScenarios({ analysis, baseCalendar: calendar, market, tier });
  rec('calendar', true, `${(calendar.entries || []).length} entries · ${scenarioSet.scenarios.length} scenarios (default ${scenarioSet.default})`, { scenarios: scenarioSet.scenarios.map((s) => ({ key: s.key, label: s.label, cadencePerWeek: s.cadencePerWeek })) });

  // 5+6. CONTENT (script) + ASSET CREATION — top entry of the default (medium) plan, score-gated retry
  const topEntry = (calendar.entries || [])[0];
  let campaign = null, review = null, attempt = 0;
  if (topEntry) {
    do {
      attempt += 1;
      try {
        campaign = await plan.buildCampaign(topEntry, config, { withCreatives });
      } catch (e) { rec('content+asset', false, `build failed: ${String(e && e.message || e)}`); break; }
      review = await reviewStage(campaign, tier);
      if (review.pass) break;
      topEntry.regenerate_counter = (topEntry.regenerate_counter || 0) + 1; // diverge on retry
    } while (attempt <= maxRetries);
    if (campaign) {
      rec('content+asset', true, `built campaign "${campaign.subject || (campaign.copy && campaign.copy.subject) || topEntry.theme || 'campaign'}" (attempt ${attempt}, creatives ${withCreatives ? 'on' : 'off'})`, { subject: campaign.subject || (campaign.copy && campaign.copy.subject) });
      rec('smart-review', !!review, review ? `score ${review.score} · ${review.pass ? 'PASS' : 'RETRY-EXHAUSTED'}` : 'n/a', review);
    }
  } else {
    rec('content+asset', false, 'no calendar entry to build');
  }

  // 8. IDEATION (net-new stage)
  const ideation = await ideate({ analysis, calendar, review: review || {}, market, tier });
  rec('ideation', true, `${ideation.ideas.length} next-actions`, { ideas: ideation.ideas.map((i) => i.title) });

  return { ok: true, mode: db.connected ? 'db-linked' : 'local-fallback', tier, market, stages, strategy, scenarios: scenarioSet, campaign, review, ideation };
}

module.exports = { runAgentic };
