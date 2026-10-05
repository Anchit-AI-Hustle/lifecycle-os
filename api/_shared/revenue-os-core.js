'use strict';

/**
 * revenue-os-core.js
 *
 * The content machine becomes useful only when it closes the commercial loop:
 *
 *   demand -> idea -> content -> distribution -> engagement -> lead ->
 *   conversion -> revenue -> attribution -> learning -> next decision
 *
 * This module sits ABOVE the source-specific platform analysts. It does not ask
 * another model to "be a CEO" and invent cross-channel conclusions. Instead it:
 *
 * 1. consumes the already-grounded platform agent queue;
 * 2. reads this workspace's measured action outcomes;
 * 3. learns conservative priors from those outcomes;
 * 4. ranks the next actions deterministically;
 * 5. gives every action a measurement contract and stable action_id so realised
 *    impact can be written back to analytics_action_outcomes;
 * 6. never fabricates expected revenue when no causal measurement exists.
 *
 * Execution remains recommendation-first. External-state changes (publishing,
 * spend, offers, customer messaging, account connections, etc.) require human
 * approval. That keeps the OS autonomous in analysis without making it reckless
 * in irreversible or customer-facing actions.
 */

const crypto = require('crypto');
const platformAgents = require('./platform-agents-core.js');
const dataAnalysis = require('./data-analysis-core.js');
const supa = require('./supa.js');

const ROLES = Object.freeze([
  { id: 'intelligence', label: 'Market Intelligence', owns: 'demand, competitors, audience questions and source readiness' },
  { id: 'strategy', label: 'Revenue Strategist', owns: 'offer, prioritisation, hypotheses and economic trade-offs' },
  { id: 'creative', label: 'Creative Production', owns: 'hooks, scripts, mailers, ads, landing-page and content variants' },
  { id: 'distribution', label: 'Distribution', owns: 'channel selection, scheduling, publishing and repurposing' },
  { id: 'conversion', label: 'Conversion', owns: 'CTA, offer, checkout, landing-page and lead capture improvements' },
  { id: 'conversations', label: 'Conversation & Support', owns: 'questions, objections, comments and support insight' },
  { id: 'analytics', label: 'Measurement', owns: 'attribution, experiments, realised impact and guardrails' },
  { id: 'controller', label: 'Growth Controller', owns: 'cross-role queue, learning loop, stop/scale decisions and approvals' },
]);

const OPERATING_LOOP = Object.freeze([
  'demand', 'idea', 'content', 'distribution', 'engagement',
  'lead', 'conversion', 'revenue', 'attribution', 'learning',
]);

const OUTCOME_STATUSES = new Set([
  'recommended', 'approved', 'launched', 'measured',
  'completed', 'failed', 'rolled_back', 'cancelled',
]);

const PRIORITY_BASE = Object.freeze({ P0: 82, P1: 68, P2: 52 });
const EFFORT_PENALTY = Object.freeze({ low: 0, med: 8, medium: 8, high: 14 });

function finite(v) {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function avg(values) {
  const xs = values.map(finite).filter((v) => v !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function normaliseKey(v) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function outcomeRows(input) {
  if (Array.isArray(input)) return input;
  if (input && Array.isArray(input.actions)) return input.actions;
  return [];
}

function measuredOutcome(row) {
  const baseline = finite(row && row.baseline_value);
  const observed = finite(row && row.observed_value);
  const revenue = finite(row && row.incremental_revenue);
  const roi = finite(row && row.roi);
  return revenue !== null || roi !== null || (baseline !== null && observed !== null);
}

function outcomeWin(row) {
  const revenue = finite(row && row.incremental_revenue);
  if (revenue !== null) return revenue > 0;
  const roi = finite(row && row.roi);
  if (roi !== null) return roi > 1;
  const baseline = finite(row && row.baseline_value);
  const observed = finite(row && row.observed_value);
  if (baseline !== null && observed !== null) return observed > baseline;
  return null;
}

function aggregatePrior(rows) {
  const measured = rows.filter(measuredOutcome);
  const wins = measured.map(outcomeWin).filter((v) => v !== null);
  const guardrails = measured.filter((r) => r && r.guardrail_breach).length;
  const rollbacks = measured.filter((r) => r && r.rolled_back).length;
  return {
    samples: rows.length,
    measured_samples: measured.length,
    win_rate: wins.length ? wins.filter(Boolean).length / wins.length : null,
    avg_incremental_revenue: avg(measured.map((r) => r.incremental_revenue)),
    avg_roi: avg(measured.map((r) => r.roi)),
    guardrail_rate: measured.length ? guardrails / measured.length : null,
    rollback_rate: measured.length ? rollbacks / measured.length : null,
  };
}

/**
 * Historical learning is descriptive, never predictive. We learn "what tended
 * to work here" but do not turn a tiny sample into a made-up revenue forecast.
 */
function buildLearning(input) {
  const rows = outcomeRows(input);
  const byChannelRows = {};
  const byTypeRows = {};

  for (const row of rows) {
    const metadata = row && row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const channel = normaliseKey(row && (row.channel || metadata.platform_id || metadata.platform || metadata.channel));
    const type = normaliseKey(row && (row.action_type || metadata.role_owner || metadata.action_type));
    (byChannelRows[channel] || (byChannelRows[channel] = [])).push(row);
    (byTypeRows[type] || (byTypeRows[type] = [])).push(row);
  }

  return {
    total_rows: rows.length,
    global: aggregatePrior(rows),
    by_channel: Object.fromEntries(Object.entries(byChannelRows).map(([k, v]) => [k, aggregatePrior(v)])),
    by_action_type: Object.fromEntries(Object.entries(byTypeRows).map(([k, v]) => [k, aggregatePrior(v)])),
    contract: 'Historical outcomes can adjust priority after measurement. They never become an unlabelled expected-revenue forecast.',
  };
}

function roleFor(action) {
  const s = [
    action && action.action,
    action && action.why,
    action && action.target_metric,
    action && action.platform,
  ].filter(Boolean).join(' ').toLowerCase();

  if (/data availability|connect|source|research|trend|competitor|audience/.test(s)) return 'intelligence';
  if (/script|creative|hook|copy|carousel|mailer|asset|ad creative|content/.test(s)) return 'creative';
  if (/publish|schedule|distribution|repurpose|channel mix|posting/.test(s)) return 'distribution';
  if (/cta|checkout|conversion|offer|landing|lead|cart|purchase/.test(s)) return 'conversion';
  if (/support|question|comment|reply|inbox|objection|customer/.test(s)) return 'conversations';
  if (/attribution|measure|analytics|report|incremental|experiment|roas|roi|cac/.test(s)) return 'analytics';
  return 'strategy';
}

function externalStateChange(action) {
  const s = String(action && action.action || '').toLowerCase();
  return /publish|post|schedule|send|launch|spend|budget|bid|price|discount|offer|checkout|message|reply|email|sms|push|connect|upload|delete|pause|enable|disable|approve/.test(s);
}

function opportunityId(market, action) {
  const raw = [
    String(market || 'ALL').toUpperCase(),
    normaliseKey(action && action.platform_id),
    normaliseKey(action && action.action),
    normaliseKey(action && action.target_metric),
  ].join('|');
  return 'rev_' + crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function priorFor(action, learning) {
  const channel = normaliseKey(action && (action.platform_id || action.platform));
  const type = normaliseKey(roleFor(action));
  return {
    channel_key: channel,
    channel: learning.by_channel[channel] || null,
    action_type_key: type,
    action_type: learning.by_action_type[type] || null,
  };
}

function scoreOpportunity(action, learning) {
  const priority = String(action && action.priority || 'P2').toUpperCase();
  const effort = normaliseKey(action && action.effort);
  const base = PRIORITY_BASE[priority] || PRIORITY_BASE.P2;
  let score = base - (EFFORT_PENALTY[effort] || 0);
  const reasons = ['priority ' + priority];

  if (action && action.target_metric) {
    score += 6;
    reasons.push('has a named target metric');
  } else {
    reasons.push('target metric is missing');
  }

  const p = priorFor(action, learning);
  const prior = p.channel && p.channel.measured_samples ? p.channel
    : (p.action_type && p.action_type.measured_samples ? p.action_type : null);

  if (prior && prior.measured_samples >= 3) {
    if (prior.win_rate !== null) {
      const delta = clamp((prior.win_rate - 0.5) * 20, -10, 10);
      score += delta;
      reasons.push('historical win rate ' + Math.round(prior.win_rate * 100) + '% across ' + prior.measured_samples + ' measured actions');
    }
    if (prior.avg_roi !== null) {
      const delta = clamp((prior.avg_roi - 1) * 6, -8, 8);
      score += delta;
      reasons.push('historical realised ROI ' + prior.avg_roi.toFixed(2));
    }
    if (prior.guardrail_rate !== null && prior.guardrail_rate > 0) {
      const penalty = clamp(prior.guardrail_rate * 30, 0, 20);
      score -= penalty;
      reasons.push('guardrail history penalised priority');
    }
    if (prior.rollback_rate !== null && prior.rollback_rate > 0) {
      const penalty = clamp(prior.rollback_rate * 20, 0, 12);
      score -= penalty;
      reasons.push('rollback history penalised priority');
    }
  } else {
    reasons.push('insufficient measured history for a learned prior');
  }

  return {
    score: Math.round(clamp(score, 0, 100)),
    evidence_grade: prior && prior.measured_samples >= 5 ? 'A' : (prior && prior.measured_samples > 0 ? 'B' : 'C'),
    historical_prior: prior,
    reasons,
  };
}

function measurementPlan(action) {
  const target = String(action && action.target_metric || '').trim();
  const role = roleFor(action);
  const sourceSetup = /data availability/i.test(target);
  return {
    target_metric: target || null,
    baseline_required: !sourceSetup,
    observed_required: true,
    revenue_attribution_required: role === 'conversion' || role === 'distribution' || role === 'creative',
    causal_preference: 'holdout or controlled experiment when practical; otherwise label the result observational',
    success_rule: sourceSetup
      ? 'the named source is connected and returns measured data'
      : (target ? 'improve the named metric without a guardrail breach' : 'define a measurable success metric before launch'),
    no_forecast_rule: 'Do not populate expected revenue unless a separate, explicit forecast with assumptions is supplied.',
  };
}

function buildOpportunity(action, learning, market) {
  const ranked = scoreOpportunity(action, learning);
  const role = roleFor(action);
  return {
    action_id: opportunityId(market, action),
    role_owner: role,
    platform: action && action.platform || null,
    platform_id: action && action.platform_id || null,
    action: action && action.action || '',
    why: action && action.why || '',
    priority: action && action.priority || 'P2',
    effort: action && action.effort || null,
    target_metric: action && action.target_metric || null,
    owner: action && action.owner || role,
    rank_score: ranked.score,
    evidence_grade: ranked.evidence_grade,
    historical_prior: ranked.historical_prior,
    ranking_reasons: ranked.reasons,
    execution_mode: 'recommend_only',
    human_approval_required: externalStateChange(action),
    expected_revenue: null,
    expected_revenue_note: 'Not estimated by Revenue OS. Realised incremental revenue is written only after measurement.',
    measurement_plan: measurementPlan(action),
  };
}

function roleWorkload(opportunities) {
  return ROLES.map((role) => {
    const items = opportunities.filter((x) => x.role_owner === role.id);
    return {
      id: role.id,
      label: role.label,
      owns: role.owns,
      queued_actions: items.length,
      top_action_id: items.length ? items[0].action_id : null,
    };
  });
}

function buildPlan({ intelligence, outcomes, market = 'US', brand = null } = {}) {
  const platform = intelligence || { coverage: {}, action_queue: [], agents: [] };
  const outcomeData = outcomes || { kpis: {}, actions: [] };
  const learning = buildLearning(outcomeData);
  const opportunities = (Array.isArray(platform.action_queue) ? platform.action_queue : [])
    .map((action) => buildOpportunity(action, learning, market))
    .sort((a, b) => b.rank_score - a.rank_score);

  const k = outcomeData.kpis || {};
  const measuredActions = finite(k.measured_actions);
  const realisedRevenue = finite(k.realized_incremental_revenue);
  const realisedRoi = finite(k.realized_roi);

  return {
    ok: true,
    system: 'Lifecycle OS Revenue OS',
    generated_at: new Date().toISOString(),
    market: String(market || 'US').toUpperCase(),
    brand: brand && brand.name ? { name: brand.name, industry: brand.industry || null } : null,
    operating_loop: OPERATING_LOOP.slice(),
    roles: roleWorkload(opportunities),
    controller: {
      north_star: 'realised incremental revenue per measured action cost',
      north_star_value: realisedRoi,
      realised_incremental_revenue: realisedRevenue,
      measured_actions: measuredActions,
      principle: 'optimise for measured business impact, not content volume or views',
      top_action_id: opportunities.length ? opportunities[0].action_id : null,
      queued_actions: opportunities.length,
    },
    source_coverage: platform.coverage || null,
    learning,
    opportunity_queue: opportunities,
    measurement_contract: {
      revenue_truth: 'analytics_action_outcomes for this workspace',
      attribution_rule: 'platform-reported revenue is not treated as incremental revenue unless the outcome ledger measures it',
      engagement_rule: 'views, opens, clicks and comments are leading indicators, never the north star by themselves',
      missing_data_rule: 'unknown stays null/blocked; it is never converted to a plausible-looking zero',
    },
    approval_policy: {
      default: 'analysis and ranking may run autonomously; external-state changes require an explicit approval',
      always_review: ['claims', 'publishing', 'media spend or bid changes', 'pricing or offers', 'customer-facing replies', 'account connections', 'destructive actions'],
    },
    note: opportunities.length
      ? 'The queue is ranked from grounded platform actions plus this workspace\\'s measured outcomes. No expected revenue is fabricated.'
      : 'No executable opportunity was produced. Connect missing sources or wait for grounded platform actions; Revenue OS does not invent work to keep itself busy.',
  };
}

async function run(opts = {}) {
  const market = String(opts.market || 'US').toUpperCase();
  const platformPromise = opts.platformSnapshot
    ? Promise.resolve(opts.platformSnapshot)
    : platformAgents.runAll({
        market,
        days: Number(opts.days) || 30,
        hours: Number(opts.hours) || 720,
        since: opts.since,
        until: opts.until,
        question: opts.question || 'What are the highest-leverage measured growth actions?',
        tier: opts.tier || 'standard',
        timeoutMs: Number(opts.timeoutMs) || 25000,
        brand: opts.brand || null,
        platforms: opts.platforms,
      });
  const outcomePromise = opts.outcomeSnapshot
    ? Promise.resolve(opts.outcomeSnapshot)
    : dataAnalysis.actions();

  const [intelligence, outcomes] = await Promise.all([platformPromise, outcomePromise]);
  return buildPlan({ intelligence, outcomes, market, brand: opts.brand || null });
}

function asBoolean(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function cleanMetadata(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [k, value] of Object.entries(v)) {
    if (['workspace_id', 'owner_id', 'user_id'].includes(k)) continue;
    out[String(k).slice(0, 80)] = value;
  }
  return out;
}

/**
 * Write the recommendation -> realised-impact loop.
 *
 * The table is workspace-scoped by supa.js, which stamps workspace_id and
 * prevents a service-role write from crossing tenants. The caller may not
 * supply workspace_id. A repeated action_id upserts only inside that workspace.
 */
async function trackOutcome(input = {}) {
  const workspaceId = await dataAnalysis.activeWorkspace();
  if (!workspaceId) {
    const e = new Error('No active brand workspace; outcome tracking is refused rather than writing an unattributed row.');
    e.status = 409;
    throw e;
  }

  const actionId = String(input.action_id || '').trim();
  if (!/^rev_[a-f0-9]{16}$/.test(actionId)) {
    const e = new Error('action_id must be a Revenue OS id such as rev_0123456789abcdef');
    e.status = 400;
    throw e;
  }

  const status = String(input.status || 'recommended').trim().toLowerCase();
  if (!OUTCOME_STATUSES.has(status)) {
    const e = new Error('invalid outcome status');
    e.status = 400;
    throw e;
  }

  const incrementalRevenue = finite(input.incremental_revenue);
  const cost = finite(input.cost);
  let roi = finite(input.roi);
  if (roi === null && incrementalRevenue !== null && cost !== null && cost > 0) {
    roi = incrementalRevenue / cost;
  }

  const now = new Date().toISOString();
  const metadata = Object.assign(cleanMetadata(input.metadata), {
    source: 'revenue-os',
    role_owner: input.role_owner || undefined,
    platform_id: input.platform_id || undefined,
  });

  const row = {
    action_type: String(input.action_type || input.role_owner || 'revenue_os_recommendation'),
    action_id: actionId,
    channel: input.channel || input.platform_id || null,
    market: String(input.market || 'US').toUpperCase(),
    owner: input.owner || input.role_owner || null,
    status,
    recommended_at: input.recommended_at || now,
    approved_at: input.approved_at || (status === 'approved' ? now : null),
    launched_at: input.launched_at || (status === 'launched' ? now : null),
    measured_at: input.measured_at || (status === 'measured' ? now : null),
    baseline_metric: input.baseline_metric || null,
    baseline_value: finite(input.baseline_value),
    observed_metric: input.observed_metric || input.baseline_metric || null,
    observed_value: finite(input.observed_value),
    incremental_revenue: incrementalRevenue,
    cost,
    roi,
    experiment_id: input.experiment_id || null,
    guardrail_breach: asBoolean(input.guardrail_breach),
    rolled_back: status === 'rolled_back' || asBoolean(input.rolled_back),
    metadata,
    updated_at: now,
  };

  const rows = await supa.insert('analytics_action_outcomes', [row], {
    upsertOn: 'workspace_id,action_id',
  });

  return {
    ok: true,
    workspace_id: workspaceId,
    outcome: Array.isArray(rows) && rows[0] ? rows[0] : row,
    note: 'Only measured values supplied by the caller are stored. Revenue OS does not backfill missing impact with estimates.',
  };
}

module.exports = {
  ROLES,
  OPERATING_LOOP,
  OUTCOME_STATUSES,
  buildLearning,
  scoreOpportunity,
  buildPlan,
  run,
  trackOutcome,
  roleFor,
  opportunityId,
};
