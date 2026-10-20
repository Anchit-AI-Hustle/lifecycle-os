'use strict';
/**
 * request-scope.js — the request that is currently being served, available to
 * code too deep in the stack to be handed it.
 * ---------------------------------------------------------------------------
 * A workspace can bring its OWN model priority and its OWN provider keys
 * (workspace-connections-core.js). The place that has to honour those is
 * llm.js, and llm.js is called from well over a hundred sites across the
 * generators, the pipeline stages, the brain services and the brand LLM. Adding
 * a `req` parameter to every one of those calls would be a very large diff for
 * a very small idea, and every site anyone forgot would silently fall back to
 * the platform keys, which is the exact failure this feature exists to prevent.
 *
 * A module-level "current request" variable is NOT an option: a warm Node
 * runtime can be serving more than one request from the same process, so a
 * shared variable would hand one brand another brand's API key. AsyncLocalStorage
 * is the primitive built for this — the store follows the async continuation
 * chain of ONE request and is invisible to every other.
 *
 * Only the entry points wrap themselves (api/brain.js, api/public-config.js,
 * api/calendar.js, api/ai/*.js). Anything running outside a wrapped handler —
 * a test, a script, a cron worker — simply sees no store and behaves exactly as
 * it did before.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/** Run `fn` with `req` as the ambient request for its whole async subtree. */
function run(req, fn) {
  // `cache` lets a consumer resolve something expensive (a workspace's routing
  // and keys) once per request instead of once per LLM call.
  return storage.run({ req, cache: new Map() }, fn);
}

/** The current store, or null when running outside a wrapped handler. */
function current() {
  return storage.getStore() || null;
}

/** The request being served, or null. */
function currentRequest() {
  const s = current();
  return (s && s.req) || null;
}

/**
 * Memoise a per-request value. The PROMISE is cached rather than the resolved
 * value, so two LLM calls racing at the start of a request share one lookup
 * instead of both issuing it.
 */
function once(key, factory) {
  const s = current();
  if (!s) return factory();
  if (s.cache.has(key)) return s.cache.get(key);
  const p = Promise.resolve().then(factory);
  s.cache.set(key, p);
  return p;
}

/**
 * Model-call outcomes of THIS request: how many answered and how many ended
 * with no answer at all (every provider failed, the call budget ran out, or no
 * provider is configured). llm.js records them; the credit meter reads them, so
 * a run that got no model answer is never charged, whatever status the handler
 * chose to answer with. Outside a request nothing is recorded.
 */
function noteLlm(kind, info) {
  const s = current();
  if (!s) return;
  if (!s.llm) s.llm = { ok: 0, failed: 0, own: 0 };
  if (kind === 'ok') {
    s.llm.ok += 1;
    // Answered on the workspace's OWN key (2026-10-17): a run whose every answer
    // came from the workspace's own models costs it no credits.
    if (info && info.own) s.llm.own += 1;
    // Which provider and model answered, on whose key, and the usage THAT
    // PROVIDER reported (2026-10-20): the meter charges the platform's share of
    // the run and the ledger shows it per provider. Bounded per request.
    if (!s.llmCalls) s.llmCalls = [];
    if (s.llmCalls.length < MAX_CALLS) s.llmCalls.push(callRow(info || {}));
  } else s.llm.failed += 1;
}
function llmOutcome() {
  const s = current();
  return s && s.llm ? Object.assign({}, s.llm) : null;
}

const MAX_CALLS = 200;
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
function callRow(info) {
  const kind = info.kind === 'image' ? 'image' : 'text';
  return {
    kind,
    provider: String(info.provider || 'unknown').slice(0, 40),
    model: info.model ? String(info.model).slice(0, 80) : null,
    key: info.own ? 'own' : 'platform',
    input_tokens: kind === 'text' ? count(info.input_tokens) : null,
    output_tokens: kind === 'text' ? count(info.output_tokens) : null,
    images: kind === 'image' ? (count(info.images) || 1) : 0,
  };
}

/**
 * What THIS request's answers used, by provider, model and whose key paid:
 *   { calls, by_provider: [{provider, model, key, kind, answers, input_tokens,
 *     output_tokens, tokens_reported, images}], platform_share, basis }
 * `platform_share` is the part of the run the PLATFORM's keys made:
 *   - basis 'tokens' when every answer was text and its provider reported both
 *     token counts (tokens on platform keys / all tokens);
 *   - basis 'answers' otherwise (platform answers / all answers), because a
 *     token and a picture are not one unit and a missing count is never guessed.
 * null when nothing answered.
 */
function llmUsage() {
  const s = current();
  const calls = (s && s.llmCalls) ? s.llmCalls.slice() : [];
  if (!calls.length) return null;
  const groups = new Map();
  for (const c of calls) {
    const k = [c.provider, c.model || '', c.key, c.kind].join('|');
    let g = groups.get(k);
    if (!g) { g = { provider: c.provider, model: c.model, key: c.key, kind: c.kind, answers: 0, input_tokens: 0, output_tokens: 0, tokens_reported: c.kind === 'text', images: 0 }; groups.set(k, g); }
    g.answers += 1;
    g.images += c.images;
    if (c.kind === 'text') {
      if (c.input_tokens == null || c.output_tokens == null) g.tokens_reported = false;
      g.input_tokens += c.input_tokens || 0;
      g.output_tokens += c.output_tokens || 0;
    }
  }
  // A group whose provider left a count out keeps the counts it DID send and
  // says `tokens_reported: false`, so a partial number is never read as whole.
  const by = Array.from(groups.values());
  const tokensKnown = calls.every((c) => c.kind === 'text' && c.input_tokens != null && c.output_tokens != null);
  let basis; let share;
  if (tokensKnown) {
    const tot = calls.reduce((a, c) => a + c.input_tokens + c.output_tokens, 0);
    const plat = calls.filter((c) => c.key === 'platform').reduce((a, c) => a + c.input_tokens + c.output_tokens, 0);
    if (tot > 0) { basis = 'tokens'; share = plat / tot; }
  }
  if (basis == null) { basis = 'answers'; share = calls.filter((c) => c.key === 'platform').length / calls.length; }
  return { calls: calls.length, by_provider: by, platform_share: share, basis };
}

/** Wrap a Vercel handler so everything it calls can see its request. */
function wrap(handler) {
  return function scopedHandler(req, res) {
    return run(req, () => handler(req, res));
  };
}

module.exports = { run, current, currentRequest, once, wrap, noteLlm, llmOutcome, llmUsage };
