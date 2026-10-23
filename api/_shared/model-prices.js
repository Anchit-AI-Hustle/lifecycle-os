'use strict';
/**
 * model-prices.js - what one answer really cost, at the provider's own price
 * (2026-10-23).
 *
 * The operator chose "real prices": a credit-paid run is charged what the
 * model that made it cost, converted to credits. Every price below was read
 * on each provider's own pricing page on 2026-10-23 (`SOURCES`), in USD per
 * million tokens, standard tier, no batch or cache discount. A model this
 * table does not list has NO price here: the run keeps its catalogue price and
 * the receipt says why; a price is never guessed or borrowed from a sibling.
 *
 * Not listed on purpose:
 *  - Amazon Bedrock: its pricing page did not expose per-model Claude rates
 *    in a readable form; Bedrock runs keep the catalogue price.
 *  - Groq, Cerebras, Cloudflare, OpenRouter, Pollinations: this deployment
 *    reaches them on free keys or keyless; their paid rates are not this
 *    deployment's cost, and a free answer is not priced as if it were paid.
 */

const SOURCES = {
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  openai: 'https://developers.openai.com/api/docs/pricing',
  gemini: 'https://ai.google.dev/gemini-api/docs/pricing',
  grok: 'https://docs.x.ai/docs/models',
  deepseek: 'https://api-docs.deepseek.com/quick_start/pricing',
};
const READ_ON = '2026-10-23';

// in / out: USD per 1M tokens. `over`: a long-prompt rate that applies to the
// WHOLE request once its prompt is at or past `tokens`. `from`: a dated price
// change the provider has announced. `peak`: DeepSeek's peak-hour rates.
const PRICES = {
  // Anthropic (first-party API)
  'claude-opus-5-5':   { provider: 'anthropic', in: 4, out: 20 },
  'claude-sonnet-5-5': { provider: 'anthropic', in: 2, out: 10 },
  'claude-haiku-5-5':  { provider: 'anthropic', in: 0.10, out: 0.50, over: { tokens: 100000, in: 0.50, out: 2.50 } },
  'claude-opus-5':     { provider: 'anthropic', in: 5, out: 25 },
  'claude-sonnet-5':   { provider: 'anthropic', in: 2, out: 10 },
  'claude-opus-4-5':   { provider: 'anthropic', in: 5, out: 25 },
  'claude-sonnet-4-5': { provider: 'anthropic', in: 3, out: 15 },
  'claude-haiku-4-5':  { provider: 'anthropic', in: 1, out: 5 },
  // OpenAI
  'gpt-5.5':     { provider: 'openai', in: 5, out: 30, over: { tokens: 272000, in: 10, out: 45 } },
  'gpt-5':       { provider: 'openai', in: 1.25, out: 10 },
  'gpt-5-mini':  { provider: 'openai', in: 0.25, out: 2 },
  'gpt-5-nano':  { provider: 'openai', in: 0.05, out: 0.40 },
  'gpt-4o':      { provider: 'openai', in: 2.50, out: 10 },
  'gpt-4o-mini': { provider: 'openai', in: 0.15, out: 0.60 },
  // Google Gemini (paid tier)
  'gemini-3.8-flash': { provider: 'gemini', in: 0.75, out: 3.75, from: { date: '2027-01-01', in: 1.50, out: 7.50 } },
  'gemini-2.5-flash': { provider: 'gemini', in: 0.30, out: 2.50 },
  'gemini-2.5-pro':   { provider: 'gemini', in: 1.25, out: 10, over: { tokens: 200000, in: 2.50, out: 15 } },
  // xAI
  'grok-4.3': { provider: 'grok', in: 1.25, out: 2.50, over: { tokens: 200000, in: 2.50, out: 5 } },
  // DeepSeek (cache miss): off-peak, and peak 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday.
  'deepseek-flash':  { provider: 'deepseek', in: 0.15, out: 0.60, peak: { in: 0.30, out: 1.20 } },
  'deepseek-v4-pro': { provider: 'deepseek', in: 0.66, out: 1.98, peak: { in: 1.32, out: 3.96 } },
};

function deepseekPeak(at) {
  const d = at ? new Date(at) : new Date();
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = d.getUTCHours();
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

/** The price row for a model id as the provider names it, or null. */
function priceOf(model) {
  const m = String(model || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PRICES, m) ? PRICES[m] : null;
}

/**
 * USD cost of one answer, from the token counts the provider reported, or
 * null when the model has no price here or a count is missing.
 */
function costUsd(model, inputTokens, outputTokens, at) {
  const p = priceOf(model);
  // A count the provider did not send is missing, not zero (Number(null) is 0).
  if (!p || inputTokens == null || outputTokens == null || inputTokens === '' || outputTokens === '') return null;
  const i = Number(inputTokens), o = Number(outputTokens);
  if (!Number.isFinite(i) || !Number.isFinite(o) || i < 0 || o < 0) return null;
  let rate = { in: p.in, out: p.out };
  const when = at ? new Date(at) : new Date();
  if (p.from && when.toISOString().slice(0, 10) >= p.from.date) rate = { in: p.from.in, out: p.from.out };
  if (p.over && i >= p.over.tokens) rate = { in: p.over.in, out: p.over.out };
  if (p.peak && deepseekPeak(when)) rate = { in: p.peak.in, out: p.peak.out };
  return (i * rate.in + o * rate.out) / 1e6;
}

/**
 * What one credit is worth in USD, from what the operator set: CREDIT_VALUE_USD,
 * else a credit pack priced in USD (its price over its credits, the cheapest
 * per credit). Null when neither says: no exchange rate is ever assumed.
 */
function creditValueUsd(packList) {
  const env = Number(process.env.CREDIT_VALUE_USD);
  if (Number.isFinite(env) && env > 0) return { usd: env, basis: 'CREDIT_VALUE_USD' };
  let best = null;
  for (const p of Array.isArray(packList) ? packList : []) {
    const pr = p && p.price;
    if (!pr || !pr.configured || pr.currency !== 'USD') continue;
    const credits = Number(p.total_credits || p.credits) || 0;
    if (!credits) continue;
    let exp = 2;
    try { exp = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).resolvedOptions().maximumFractionDigits; } catch (_) { exp = 2; }
    const usd = (pr.amount_minor / Math.pow(10, exp)) / credits;
    if (!best || usd < best.usd) best = { usd, basis: `the ${p.label} pack (${pr.display} for ${credits} credits)` };
  }
  return best;
}

module.exports = { PRICES, SOURCES, READ_ON, priceOf, costUsd, creditValueUsd, deepseekPeak };
