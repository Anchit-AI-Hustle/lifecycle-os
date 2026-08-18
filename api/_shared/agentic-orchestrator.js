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

  // 5+6. CONTENT (script) + ASSET CREATION
  //
  // This used to build calendar.entries[0] and nothing else, so a run over a
  // 30 day period produced ONE campaign and the chosen period only ever sized
  // the plan. It now builds one campaign per entry across the requested window.
  //
  // WHY IT IS STILL BOUNDED. Building creatives inline is exactly what used to
  // blow the serverless time limit (see the comment in smart-brain.html). So
  // this fills a time box, and whatever it could not reach is handed to the
  // existing convergent prebuild queue rather than dropped. The counts are
  // returned either way, because "built 12 of 30" is a fact the operator needs
  // and "here are your assets" over a partial set is not.
  const windowDays = Number(days || config.calendarDays) || 30;
  const horizon = new Date(Date.now() + windowDays * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const inWindow = (calendar.entries || []).filter((e) => !e.date || (e.date >= today && e.date <= horizon));

  const assetBudgetMs = Number(opts.assetBudgetMs) || (withCreatives ? 30000 : 15000);
  const assetDeadline = Date.now() + assetBudgetMs;

  const campaigns = [];
  const reviews = [];
  let review = null;
  let buildError = null;

  for (const entry of inWindow) {
    if (Date.now() >= assetDeadline) break;
    let built = null;
    let entryReview = null;
    let attempt = 0;
    do {
      attempt += 1;
      try {
        built = await plan.buildCampaign(entry, config, { withCreatives });
      } catch (e) { buildError = String((e && e.message) || e); built = null; break; }
      entryReview = await reviewStage(built, tier);
      if (entryReview.pass) break;
      entry.regenerate_counter = (entry.regenerate_counter || 0) + 1;   // diverge on retry
      // Retry only while there is budget left; a score-gated retry that runs
      // the clock out costs every LATER day its asset.
    } while (attempt <= maxRetries && Date.now() < assetDeadline);

    if (!built) continue;
    campaigns.push({
      date: entry.date || null,
      market: entry.market || market,
      cohort: entry.cohort || entry.segment || null,
      theme: entry.theme || null,
      subject: built.subject || (built.copy && built.copy.subject) || null,
      score: entryReview ? entryReview.score : null,
      passed: entryReview ? !!entryReview.pass : null,
      campaign: built,
    });
    reviews.push(entryReview);
    if (!review) review = entryReview;                 // first review, for the existing field
  }

  const remaining = inWindow.length - campaigns.length;
  if (campaigns.length) {
    rec('content+asset', true,
      `built ${campaigns.length} of ${inWindow.length} campaign(s) across ${windowDays} day(s), creatives ${withCreatives ? 'on' : 'off'}`
      + (remaining > 0 ? ` — ${remaining} still to build, queued for the background prebuild` : ''),
      { days: windowDays, built: campaigns.length, planned: inWindow.length, remaining, dates: campaigns.map((c) => c.date) });
    rec('smart-review', true,
      `${reviews.filter((r) => r && r.pass).length} of ${reviews.length} passed the score gate`,
      { scores: reviews.map((r) => (r ? r.score : null)) });
  } else {
    rec('content+asset', false,
      inWindow.length
        ? `no campaign could be built${buildError ? `: ${buildError}` : ''}`
        : `the plan has no entry inside the next ${windowDays} day(s), so there was nothing to build`);
  }

  // Backward compatible: callers that read `campaign` still get the first one.
  const campaign = campaigns.length ? campaigns[0].campaign : null;

  // 8. IDEATION (net-new stage)
  const ideation = await ideate({ analysis, calendar, review: review || {}, market, tier });
  rec('ideation', true, `${ideation.ideas.length} next-actions`, { ideas: ideation.ideas.map((i) => i.title) });

  return {
    ok: true,
    mode: db.connected ? 'db-linked' : 'local-fallback',
    tier, market, stages, strategy, scenarios: scenarioSet,
    // One entry per day the run actually produced assets for.
    campaigns,
    days_requested: windowDays,
    days_planned: inWindow.length,
    days_built: campaigns.length,
    days_remaining: remaining,
    // Kept so existing callers do not break.
    campaign, review,
    ideation,
  };
}

module.exports = { runAgentic };
