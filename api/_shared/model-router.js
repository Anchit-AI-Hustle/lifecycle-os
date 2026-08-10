'use strict';
/**
 * model-router.js — choose the model cascade by APTNESS and by CREDIT BUDGET.
 *
 * llm.js already cascades across providers and demotes on failure. What it did
 * NOT do is decide how much horsepower a job deserves, or notice that the
 * workspace is nearly out of credits. Every caller hardcoded a tier, so a
 * one-line subject rewrite could burn a premium model while a full landing page
 * ran on a fast one, and a workspace at 3 credits still queued premium calls
 * that would fail at settlement.
 *
 * Two independent inputs:
 *
 *   APTNESS  — what the job actually needs. Long-form, structurally complex or
 *              brand-voice-critical work earns 'premium'; short, mechanical or
 *              deterministic work earns 'fast'. Everything else is 'standard'.
 *
 *   BUDGET   — what the workspace can afford right now. The tier is CAPPED (never
 *              raised) by the remaining balance, so a nearly-empty wallet
 *              degrades quality gracefully instead of failing the run.
 *
 * The result is a tier plus an explicit, human-readable reason, so a operator
 * can always see WHY a given model ran. Nothing here fabricates capability: if
 * the budget cannot cover even the cheapest tier, `allowed` is false and the
 * caller must decline rather than silently spending.
 */

// Relative cost weight per tier. Used only to compare, never billed directly -
// credit-catalog.js remains the single source of truth for what a feature costs.
const TIER_WEIGHT = { fast: 1, standard: 3, premium: 8 };

// How apt each job family is for a bigger model. Highest match wins.
// Keys are matched against the caller's `stage`/feature key, case-insensitive.
const APTNESS = [
  // Long-form, structural or brand-critical: worth the best model available.
  { re: /(landing|lp_|mailer_full|mailer-full|campaign|strategy|blog|long_?form|editorial|narrative|report|research|market_study|ideology|agentic)/i, tier: 'premium',
    why: 'long-form or structural output where model quality changes the result' },
  // Brand voice and compliance: mistakes here are expensive to catch later.
  { re: /(brand_voice|voice|claims|guardrail|qa|critic|review)/i, tier: 'premium',
    why: 'brand-voice or compliance judgement' },
  // Short, bounded, mechanical: a fast model is genuinely sufficient.
  { re: /(subject|preheader|headline|hashtag|alt_?text|caption|tag|classif|extract|summar|title|rename|translate)/i, tier: 'fast',
    why: 'short bounded output where a fast model is sufficient' },
  // Structured JSON with a fixed schema: correctness over prose.
  { re: /(json|schema|plan|calendar|cohort|segment)/i, tier: 'standard',
    why: 'structured output with a fixed schema' },
];

function aptnessFor(stage) {
  const s = String(stage || '');
  for (const rule of APTNESS) if (rule.re.test(s)) return { tier: rule.tier, why: rule.why };
  return { tier: 'standard', why: 'default: no aptness rule matched this stage' };
}

/**
 * Cap a tier by what the wallet can afford.
 * `balance` and `cost` are in credits; `cost` is this feature's catalogue price.
 */
function capByBudget(tier, balance, cost) {
  if (!Number.isFinite(balance)) return { tier, why: '' };          // unknown balance: do not degrade
  const need = Number.isFinite(cost) ? cost : 0;
  if (balance <= 0) return { tier: null, why: 'no credits remaining' };
  // Headroom multiples: how many more runs of this size the wallet holds.
  const runs = need > 0 ? balance / need : Infinity;
  if (runs >= 5) return { tier, why: '' };
  if (runs >= 2) {
    return tier === 'premium'
      ? { tier: 'standard', why: `budget is tight (about ${runs.toFixed(1)} runs left), so quality is stepped down one tier` }
      : { tier, why: '' };
  }
  return {
    tier: 'fast',
    why: `budget is nearly exhausted (about ${runs.toFixed(1)} runs left), so the cheapest capable model is used`,
  };
}

/**
 * Decide the tier for one call.
 *
 * @param {object} o
 * @param {string} o.stage        what is being generated (feature key or stage name)
 * @param {number} [o.balance]    remaining credits for the workspace (omit if unknown)
 * @param {number} [o.cost]       catalogue cost of this feature in credits
 * @param {string} [o.requested]  an explicit tier the caller insists on (still budget-capped)
 * @returns {{tier:string|null, allowed:boolean, reason:string, aptness:string, weight:number}}
 */
function chooseTier({ stage, balance, cost, requested } = {}) {
  const apt = aptnessFor(stage);
  const base = requested ? String(requested).toLowerCase() : apt.tier;
  const start = ['fast', 'standard', 'premium'].includes(base) ? base : apt.tier;
  const capped = capByBudget(start, balance, cost);

  if (!capped.tier) {
    return {
      tier: null, allowed: false, aptness: apt.tier, weight: 0,
      reason: `Declined: ${capped.why}. Nothing was generated and no credits were spent.`,
    };
  }
  const reasonBits = [
    requested ? `caller requested "${start}"` : `aptness: ${apt.why}`,
  ];
  if (capped.why) reasonBits.push(capped.why);
  return {
    tier: capped.tier,
    allowed: true,
    aptness: apt.tier,
    weight: TIER_WEIGHT[capped.tier] || 1,
    reason: reasonBits.join('; '),
  };
}

/**
 * Read the workspace's credit balance (service-role). Returns null when it
 * cannot be determined - callers then run UNCAPPED rather than degrading on a
 * guess, because a wrong "no credits" would block real work.
 */
async function balanceFor(env, workspaceId) {
  if (!env || !env.url || !env.key || !workspaceId) return null;
  try {
    const r = await fetch(`${env.url}/rest/v1/credit_wallets?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=balance&limit=1`, {
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
    });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    const b = rows && rows[0] && rows[0].balance;
    return Number.isFinite(+b) ? +b : null;
  } catch (_) { return null; }
}

/** The catalogue cost of a feature key, or null when it is not priced. */
function costFor(featureKey) {
  try {
    const cat = require('./credit-catalog.js');
    const list = cat.FEATURES || cat.CATALOG || [];
    const hit = (Array.isArray(list) ? list : []).find((f) => f.key === featureKey);
    return hit ? Number(hit.cost) : null;
  } catch (_) { return null; }
}

/**
 * One-call convenience: resolve balance + cost + aptness into a decision.
 * Never throws; on any failure it returns an uncapped aptness-only decision so
 * a routing problem can never block generation.
 */
async function route({ stage, featureKey, workspaceId, env, requested } = {}) {
  let balance = null;
  try { balance = await balanceFor(env, workspaceId); } catch (_) { balance = null; }
  const cost = featureKey ? costFor(featureKey) : null;
  return chooseTier({ stage, balance, cost, requested });
}

module.exports = { chooseTier, aptnessFor, capByBudget, balanceFor, costFor, route, TIER_WEIGHT, APTNESS };
