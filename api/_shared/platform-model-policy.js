'use strict';
/**
 * platform-model-policy.js - which model the PLATFORM pays for, how much of
 * the operator's money it has spent, and when each person should move to a
 * model of their own (2026-11-09).
 *
 * The operator: "ensure claude opus 5.5 from aws bedrock only with my personal
 * credits is used till they are exhausted for all users initially and then
 * gradually with usage nudge each user to use their own api keys - keep a
 * notification alert for this to help users get the best as per their model
 * purchased already".
 *
 * - `PLATFORM_LLM_ONLY=bedrock` (operator switch, off by default): the
 *   platform's own model chain is Claude Opus 5.5 on Amazon Bedrock and
 *   nothing else (no free tier, no keyless model, no other paid provider).
 *   `BEDROCK_TEXT_MODEL_MAX` names the model id (default
 *   `anthropic.claude-opus-5-5`). A person's own keys are untouched: they come
 *   first for that person, as before.
 * - `PLATFORM_BEDROCK_BUDGET_USD`: the operator's money for it. Every answer
 *   the platform's Bedrock key makes is recorded (`platform_model_usage`, per
 *   day, per user, per model, tokens as Bedrock reported them) and priced. When
 *   the recorded spend reaches the budget the platform model is OFF for
 *   everyone; a person with their own key keeps working, everyone else is
 *   told to connect one. No budget set = no cap known, said as such.
 * - The price per token is the operator's (`PLATFORM_BEDROCK_PRICE_IN` /
 *   `_OUT`, USD per million tokens) else Anthropic's own list price for the
 *   same model from model-prices.js, labelled an ESTIMATE: Bedrock's own
 *   per-model Claude rates were not read (see model-prices.js). AWS Billing
 *   remains the real record of what was charged.
 * - `nudgeFor()`: how strongly THIS person is asked to connect their own key,
 *   rising with how much of the platform model they have used and how much of
 *   the budget is gone. Never shown to someone already using their own model.
 */

const prices = require('./model-prices.js');

const DEFAULT_MODEL = 'anthropic.claude-opus-5-5';
const CACHE_MS = 60 * 1000;

function bedrockOnly() {
  return String(process.env.PLATFORM_LLM_ONLY || '').trim().toLowerCase() === 'bedrock';
}
function model() {
  return String(process.env.BEDROCK_TEXT_MODEL_MAX || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}
function budgetUsd() {
  const n = Number(process.env.PLATFORM_BEDROCK_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** USD per million tokens for a Bedrock model id, and where the number came from. */
function priceFor(modelId) {
  const pin = Number(process.env.PLATFORM_BEDROCK_PRICE_IN);
  const pout = Number(process.env.PLATFORM_BEDROCK_PRICE_OUT);
  if (Number.isFinite(pin) && pin >= 0 && Number.isFinite(pout) && pout >= 0) return { in: pin, out: pout, basis: 'operator' };
  const base = String(modelId || '').replace(/^(?:[a-z]{2}\.)?anthropic\./, '').replace(/[-:]v\d.*$/, '').replace(/:\d+$/, '');
  const row = prices.priceOf(base);
  if (row) return { in: row.in, out: row.out, basis: 'estimate', note: 'Anthropic list price for ' + base + ' (Bedrock rates not read)' };
  return null;
}
function costUsd(modelId, inputTokens, outputTokens) {
  const p = priceFor(modelId);
  if (!p || inputTokens == null || outputTokens == null) return null;
  return (Number(inputTokens) * p.in + Number(outputTokens) * p.out) / 1e6;
}

// ── Store (service role; the table has no policy for anyone else) ───────────
function storeEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: String(url).replace(/\/$/, ''), key } : null;
}
async function rpc(fn, args, timeoutMs) {
  const e = storeEnv();
  if (!e) throw new Error('store not configured');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs || 2500);
  try {
    const res = await fetch(e.url + '/rest/v1/rpc/' + fn, {
      method: 'POST', signal: ctl.signal, cache: 'no-store',
      headers: { apikey: e.key, authorization: 'Bearer ' + e.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(fn + ' -> ' + res.status + ': ' + text.slice(0, 200));
    return text ? JSON.parse(text) : null;
  } finally { clearTimeout(t); }
}

// The spend total is read at most once a minute per instance; answers made
// here since that read are added locally so an instance never under-counts
// its own spend while it waits for the next read.
const state = { spent: null, at: 0, localSince: 0, reading: null, error: null };
function reset() { state.spent = null; state.at = 0; state.localSince = 0; state.reading = null; state.error = null; }

async function refresh(force) {
  if (!bedrockOnly() || budgetUsd() == null) return state;
  if (!force && state.at && Date.now() - state.at < CACHE_MS) return state;
  if (state.reading) return state.reading;
  state.reading = (async () => {
    try {
      const r = await rpc('platform_usage_total', {}, 2000);
      const row = Array.isArray(r) ? r[0] : r;
      state.spent = Number(row && row.usd) || 0;
      state.localSince = 0;
      state.error = null;
    } catch (err) {
      state.error = err.message;
    } finally {
      state.at = Date.now();
      state.reading = null;
    }
    return state;
  })();
  return state.reading;
}

function spentUsd() { return state.spent == null ? null : state.spent + state.localSince; }

/** The platform model may still be used (no cap, or spend below it). */
function platformOpen() {
  const b = budgetUsd();
  if (b == null) return true;
  const s = spentUsd();
  if (s == null) return true; // never read: the store decides on the next read, the model is not refused on a guess
  return s < b;
}

/**
 * The platform's provider order under this policy, or null when the policy is
 * off (the caller keeps its own order).
 */
function platformOrder() {
  if (!bedrockOnly()) return null;
  return platformOpen() ? ['bedrock'] : [];
}

/** Record one answer made on the platform's Bedrock key. Never throws. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function record({ model: m, input_tokens, output_tokens, user_id, workspace_id }) {
  if (!bedrockOnly()) return null;
  if (!UUID.test(String(user_id || ''))) user_id = null;
  if (!UUID.test(String(workspace_id || ''))) workspace_id = null;
  const usd = costUsd(m, input_tokens, output_tokens);
  if (usd != null) state.localSince += usd;
  try {
    await rpc('platform_usage_add', {
      p_user: user_id || null, p_workspace: workspace_id || null, p_model: String(m || ''),
      p_in: input_tokens == null ? null : Math.round(input_tokens),
      p_out: output_tokens == null ? null : Math.round(output_tokens),
      p_usd: usd,
    }, 3000);
    return { recorded: true, usd };
  } catch (err) {
    console.warn('[platform-model] usage not recorded: ' + err.message);
    return { recorded: false, usd };
  }
}

// ── The nudge ────────────────────────────────────────────────────────────────
// Thresholds in the platform model's answers made for this person. The first
// few runs are left alone; past them the person is told once, then asked
// more firmly; when the operator's money is nearly gone (80%) everyone who
// still depends on it is asked firmly, and when it is gone it is required.
const LEVELS = { tip: 10, suggest: 50, strong: 200 };

// What a person can connect, said as "the model you already pay for". Each
// entry names how this app takes it (a sign-in where the provider offers one
// to a hosted app, else a key from that provider's own page).
const OWN_MODEL_OPTIONS = [
  { provider: 'anthropic', name: 'Claude (Anthropic)', how: 'key', where: 'https://platform.claude.com/settings/keys', note: 'A Claude.ai chat plan does not include API use; an API key from the Claude Console does.' },
  { provider: 'openai', name: 'ChatGPT / OpenAI', how: 'key', where: 'https://platform.openai.com/api-keys', note: 'A ChatGPT plan does not include API use; an API key with credit does.' },
  { provider: 'gemini', name: 'Google Gemini', how: 'sign-in', where: '/ai-models', note: 'Sign in with Google, or paste a key from Google AI Studio.' },
  { provider: 'bedrock', name: 'Claude on Amazon Bedrock', how: 'key', where: 'https://console.aws.amazon.com/bedrock/', note: 'Your own AWS account, billed by AWS.' },
  { provider: 'openrouter', name: 'OpenRouter', how: 'sign-in', where: '/ai-models', note: 'One sign-in reaches many models on your OpenRouter credit.' },
  { provider: 'huggingface', name: 'Hugging Face', how: 'sign-in', where: '/ai-models', note: 'Sign in with Hugging Face; uses your Inference Providers credit.' },
  { provider: 'grok', name: 'Grok (xAI)', how: 'key', where: 'https://console.x.ai', note: 'An API key from the xAI console.' },
];

/**
 * How strongly to ask this person to connect their own model.
 * @param {{ answers:number|null, usd:number|null }} mine  the platform model's use made for this person
 * @param {{ ownConnected:boolean }} person
 */
function nudgeFor(mine, person) {
  const policy = { bedrock_only: bedrockOnly(), model: bedrockOnly() ? model() : null, budget_usd: budgetUsd(), spent_usd: spentUsd() };
  policy.used_share = policy.budget_usd != null && policy.spent_usd != null ? Math.min(1, policy.spent_usd / policy.budget_usd) : null;
  policy.exhausted = bedrockOnly() && !platformOpen();
  if (person && person.ownConnected) return { level: 'none', reason: 'own_model_connected', policy };
  const answers = mine && Number.isFinite(mine.answers) ? mine.answers : 0;
  let level = 'none';
  if (answers >= LEVELS.tip) level = 'tip';
  if (answers >= LEVELS.suggest) level = 'suggest';
  if (answers >= LEVELS.strong) level = 'strong';
  if (policy.used_share != null && policy.used_share >= 0.8 && answers > 0) level = 'strong';
  if (policy.exhausted) level = 'required';
  const label = policy.model ? 'Claude Opus 5.5' : 'the platform\'s models';
  const MESSAGES = {
    none: '',
    tip: 'You have made ' + answers + ' runs on ' + label + ', on us. Connect the model you already pay for and it runs on your own account, with no credits taken.',
    suggest: answers + ' runs so far on ' + label + ', on us. For the best results from the model you already pay for, connect it on AI Models: it is used first for your brands.',
    strong: (policy.used_share != null && policy.used_share >= 0.8
      ? 'The free ' + label + ' allowance is nearly used up (' + Math.round(policy.used_share * 100) + '%). '
      : answers + ' runs on ' + label + ' so far. ')
      + 'Connect your own model now so your generations keep running when it ends.',
    required: 'The free ' + label + ' allowance is used up. Connect your own model on AI Models to keep generating; until then, copy comes from templates.',
  };
  return { level, answers, usd: mine && mine.usd != null ? mine.usd : null, message: MESSAGES[level], options: level === 'none' ? [] : OWN_MODEL_OPTIONS, link: '/ai-models', policy };
}

/** The platform model's use made for one person, all time. */
async function usageFor(userId) {
  if (!userId) return { answers: 0, usd: null };
  try {
    const r = await rpc('platform_usage_for_user', { p_user: userId }, 2500);
    const row = Array.isArray(r) ? r[0] : r;
    return { answers: Number(row && row.answers) || 0, usd: row && row.usd != null ? Number(row.usd) : null };
  } catch (_) {
    return { answers: null, usd: null, unavailable: true };
  }
}

module.exports = {
  bedrockOnly, model, budgetUsd, priceFor, costUsd,
  refresh, spentUsd, platformOpen, platformOrder, record,
  nudgeFor, usageFor, LEVELS, OWN_MODEL_OPTIONS, _reset: reset, _state: state,
};
