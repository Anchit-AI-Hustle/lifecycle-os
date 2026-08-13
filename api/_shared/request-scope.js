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

/** Wrap a Vercel handler so everything it calls can see its request. */
function wrap(handler) {
  return function scopedHandler(req, res) {
    return run(req, () => handler(req, res));
  };
}

module.exports = { run, current, currentRequest, once, wrap };
