'use strict';
/**
 * time-budget.js - answer before the platform kills the function (2026-10-13).
 * ---------------------------------------------------------------------------
 * /api/brain hit Vercel's 120 s maxDuration 11 times in production. A killed
 * invocation sends a bare 504, says nothing about what finished, and never
 * settles its credit hold. So each request carries a DEADLINE inside
 * maxDuration (in the request scope, request-scope.js):
 *   - llm.js never budgets a model call past it (one slow provider cannot carry
 *     the run over the edge);
 *   - guard() answers AT the deadline with the steps the run recorded via
 *     step() and one sentence, as { ok:false, partial:true }, which the credit
 *     meter releases; a write the handler makes afterwards is dropped.
 * A handler that finishes in time is untouched.
 *
 * NOT a function file (api/_shared/ is outside the 12-function cap).
 */

const scope = require('./request-scope.js');

// maxDuration minus room to settle the credit hold (bounded at 8 s in
// credits-core) and send the answer. Env-overridable per router.
const BUDGETS = {
  'api/brain.js': { env: 'BRAIN_TIME_BUDGET_MS', ms: 100000 },
  'api/calendar.js': { env: 'CALENDAR_TIME_BUDGET_MS', ms: 100000 },
};
function budgetFor(fn) {
  const b = BUDGETS[fn];
  if (!b) return 0;
  const n = Number(process.env[b.env]);
  return n > 0 ? n : b.ms;
}

function setDeadline(at) { const s = scope.current(); if (s) s.deadline = at; }
/** Milliseconds left before this request's deadline, or Infinity outside one. */
function timeLeft() {
  const s = scope.current();
  return s && s.deadline ? s.deadline - Date.now() : Infinity;
}
/** Record a finished step, named in words an operator reads. */
function step(name) {
  const s = scope.current();
  if (!s) return;
  if (!s.steps) s.steps = [];
  s.steps.push(String(name).slice(0, 160));
}

function guard(handler, opts) {
  const o = opts || {};
  return async function timeBudgetedHandler(req, res) {
    if (req && req.method === 'OPTIONS') return handler(req, res);
    const budgetMs = typeof o.budgetMs === 'function' ? o.budgetMs() : Number(o.budgetMs) || 0;
    if (!(budgetMs > 0)) return handler(req, res);
    const started = Date.now();
    setDeadline(started + budgetMs);
    const store = scope.current();

    // The handler writes through a VIEW of the response, never the response
    // itself: the credit meter restores its own methods on `res` after it has
    // flushed, so silencing by patching `res` would be undone and a late write
    // would reach a finished response.
    let answered = false;
    let late = false;
    const WRITES = { json: true, end: true, send: true, redirect: true, status: false, setHeader: false, writeHead: false, write: false };
    const view = new Proxy(res, {
      get(t, k) {
        const v = t[k];
        if (typeof v !== 'function') return v;
        if (Object.prototype.hasOwnProperty.call(WRITES, k)) {
          return (...a) => {
            if (late) return view;
            if (WRITES[k]) answered = true;
            const out = v.apply(t, a);
            return out === t ? view : out;
          };
        }
        return v.bind(t);
      },
      set(t, k, v) { if (!late) t[k] = v; return true; },
    });
    const origJson = (p) => res.json(p);
    const origStatus = (c) => res.status(c);

    let timer;
    const work = Promise.resolve().then(() => handler(req, view));
    const timeout = new Promise((r) => { timer = setTimeout(() => r('timeout'), budgetMs); });
    let which;
    try { which = await Promise.race([work.then(() => 'done'), timeout]); }
    finally { clearTimeout(timer); }
    if (which === 'done' || answered) {
      if (which !== 'done') work.catch(() => {});
      return undefined;
    }
    work.catch(() => {});
    const action = (req && req.query && req.query.action) || '';
    const completed = (store && store.steps) ? store.steps.slice() : [];
    const secs = Math.round((Date.now() - started) / 1000);
    const payload = {
      ok: false, partial: true, state: 'time_budget_exhausted', action, completed,
      message: `This ${o.label || 'request'} stopped after ${secs} s so it could answer before the server's time limit. `
        + (completed.length ? `Finished: ${completed.join('; ')}. ` : 'No step had finished. ')
        + 'Nothing was charged. Run it again, or with a shorter window or fewer markets.',
    };
    origStatus(200);
    origJson(payload);
    late = true;
    return undefined;
  };
}

module.exports = { guard, step, setDeadline, timeLeft, budgetFor, BUDGETS };
