'use strict';
// THE ASSISTANT'S EVALUATION (2026-11-27). Part of the built-in kit
// (assistant-kit.js): a run that measures, for THIS brand, whether retrieval
// finds the brand's own facts and whether an answer written from the retrieved
// passages stays inside them, and keeps each run so a later one can be compared
// with it ("a new version does not quietly get worse").
//
// Three measurements, each a count of something that happened:
//   retrieval   for each fact the record states (a claim, an offering, a
//               product), a question made of that fact's own words is asked of
//               the retriever; a hit is the fact's passage in the top 5.
//   made_up     an answer is written from the passages (one model call per
//               question, fast tier); in CODE, every figure in the answer must
//               appear in the passages it was given. A figure that does not is
//               counted and listed.
//   judge       a second model reads question, passages and answer and scores
//               grounded and relevant 0-5, naming any sentence the passages do
//               not support (LLM as judge). A judge that did not answer is
//               null, never a score.
// The test set comes from the record; a brand with no stated fact has nothing
// to evaluate and is told so. Nothing here rewrites an answer.

const KIT = require('./assistant-kit.js');
const OC = require('./output-contract.js');
const str = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

function testSet(brand, docs) {
  const b = brand || {};
  const name = str(b.name).toLowerCase();
  const out = [];
  const seen = new Set();
  const add = (kind, fact) => {
    const f = str(fact);
    const words = KIT.tokens(f).filter((w) => name.indexOf(w) < 0);
    if (words.length < 2 || seen.has(f.toLowerCase())) return;
    seen.add(f.toLowerCase());
    out.push({ kind, fact: f, question: `What does ${b.name || 'the brand'} say about ${words.slice(0, 5).join(' ')}?` });
  };
  for (const c of Array.isArray(b.claims) ? b.claims : []) add('claim', c);
  for (const o of Array.isArray(b.offerings) ? b.offerings : []) add('offering', o && o.name);
  if (str(b.tagline)) add('tagline', b.tagline);
  for (const d of (docs || []).filter((x) => x.source === 'catalogue').slice(0, 6)) add('product', d.title);
  return out.slice(0, 12);
}

const foldText = (t) => str(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
// Figures an answer states: numbers with at least two digits, or with a unit sign.
function figures(t) { return [...new Set((String(t || '').match(/(?:[$€£₹]\s?)?\d[\d,]*(?:\.\d+)?%?/g) || []).map((x) => x.replace(/[,\s]/g, '')).filter((x) => /\d{2,}|%|[$€£₹]/.test(x)))]; }

function answerSpec(brand) {
  return { id: 'ai-eval.answer', kind: 'reply', format: 'text', brand: (brand && brand.name) || 'this brand', missing: 'say', returns: 'A short answer (at most 3 sentences) that uses ONLY the passages. If they do not answer the question, say exactly that. Cite the passage number in brackets.', forbid: ['any fact, figure or claim that is not in the passages'] };
}
function judgeSpec(brand) {
  return { id: 'ai-eval.judge', kind: 'data', format: 'json', brand: (brand && brand.name) || 'this brand', missing: 'say', returns: 'ONE JSON object scoring the answer against the passages.', schema: { grounded: { type: 'number', note: '0-5: 5 = every statement is supported by the passages' }, relevant: { type: 'number', note: '0-5: 5 = it answers the question asked' }, unsupported: { type: 'array', required: false, items: { type: 'string' }, note: 'each sentence of the answer the passages do not support, verbatim' } } };
}

/**
 * run({ brand, workspaceId, market, userId, llm, limit, key })
 *  -> { ok, scores, cases, compared, stored }
 */
async function run(opts = {}) {
  const b = opts.brand || {};
  const llm = opts.llm || require('./llm.js');
  const docs = await KIT.corpus({ brand: b, workspaceId: opts.workspaceId, market: opts.market });
  const set = testSet(b, docs);
  if (!set.length) {
    return { ok: false, error: 'nothing_to_evaluate', message: `${b.name || 'This brand'} states no claim, offering, tagline or product on its record, so there is no fact to test retrieval or answers against. Add them in Brand Setup, or import the catalogue.` };
  }
  const cases = [];
  let hits = 0;
  for (const t of set) {
    const got = await KIT.retrieve(t.question, { docs, limit: 5, key: opts.key });
    const want = foldText(t.fact).slice(0, 60);
    const at = (got.items || []).findIndex((x) => foldText(`${x.title} ${x.text}`).indexOf(want) >= 0);
    if (at >= 0) hits += 1;
    cases.push({ kind: t.kind, question: t.question, fact: t.fact, retrieved_at: at >= 0 ? at + 1 : null, ranked_by: got.ranked_by, passages: (got.items || []).map((x) => ({ source: x.source, title: x.title, text: x.text })) });
  }
  // Answers and the judge: at most `limit` questions (each is two model calls).
  const n = Math.max(0, Math.min(Number(opts.limit) || 3, 4, cases.length));
  let judged = 0; let grounded = 0; let relevant = 0; let madeUp = 0; let answered = 0; const models = new Set();
  for (const c of cases.slice(0, n)) {
    const ctx = KIT.contextBlock({ items: c.passages });
    let ans = null;
    try {
      const out = await llm({ systemPrompt: `You answer questions about ${b.name || 'a brand'} from passages of its own documents.`, userMessage: OC.append(`${ctx}\n\nQUESTION: ${c.question}`, answerSpec(b)), maxTokens: 300, temperature: 0.2, tier: 'fast', stage: 'ai-eval', timeoutMs: 15000 });
      ans = str(out && out.text); if (out && out.provider) models.add(`${out.provider}${out.model ? ':' + out.model : ''}`);
    } catch (e) { c.answer_error = str(e && e.message).slice(0, 160); }
    if (!ans) { c.answer = null; continue; }
    answered += 1;
    c.answer = ans;
    const src = foldText(ctx + ' ' + c.question).replace(/\s/g, '');
    c.made_up_figures = figures(ans.replace(/\[\d+\]/g, '')).filter((f) => src.indexOf(f.toLowerCase().replace(/[^a-z0-9]/g, '')) < 0);
    if (c.made_up_figures.length) madeUp += 1;
    try {
      const spec = judgeSpec(b);
      const out = await llm({ systemPrompt: 'You are a strict evaluator. You judge an answer only against the passages given, never against your own knowledge.', userMessage: OC.append(`${ctx}\n\nQUESTION: ${c.question}\n\nANSWER TO JUDGE: ${ans}`, spec), responseFormat: { type: 'json_object' }, maxTokens: 400, temperature: 0, tier: 'fast', stage: 'ai-eval-judge', timeoutMs: 15000 });
      const v = OC.parse(str(out && out.text), spec);
      const val = v && (v.value || v);
      const g = Number(val && val.grounded); const r = Number(val && val.relevant);
      if (Number.isFinite(g) && Number.isFinite(r) && g >= 0 && g <= 5 && r >= 0 && r <= 5) {
        c.judge = { grounded: g, relevant: r, unsupported: Array.isArray(val.unsupported) ? val.unsupported.map(str).filter(Boolean).slice(0, 5) : [] };
        judged += 1; grounded += g; relevant += r;
      } else c.judge = null;
    } catch (e) { c.judge = null; c.judge_error = str(e && e.message).slice(0, 160); }
  }
  const scores = {
    retrieval: { hits, of: set.length, rate: +(hits / set.length).toFixed(3), ranked_by: cases[0] ? cases[0].ranked_by : 'none' },
    answers: { asked: n, answered, with_made_up_figures: answered ? madeUp : null },
    judge: judged ? { judged, grounded: +(grounded / judged).toFixed(2), relevant: +(relevant / judged).toFixed(2) } : { judged: 0, grounded: null, relevant: null, reason: n ? 'No judge answered (no model reached, or it did not return a score).' : 'No answer was asked for.' },
    models: [...models],
  };
  const result = { ok: true, at: new Date().toISOString(), brand: b.name || '', documents: docs.length, scores, cases };
  // Tracking: keep the run, compare with the one before it.
  result.stored = 'none';
  if (KIT.isUuid(opts.workspaceId)) {
    try {
      const prev = await KIT.svc(`ai_eval_runs?workspace_id=eq.${opts.workspaceId}&select=scores,created_at&order=created_at.desc&limit=1`);
      result.compared = compare(scores, prev && prev[0]);
      await KIT.svc('ai_eval_runs', { method: 'POST', prefer: 'return=minimal', body: [{ workspace_id: opts.workspaceId, run_by: KIT.isUuid(opts.userId) ? opts.userId : null, scores, cases: cases.map((c) => ({ kind: c.kind, question: c.question, retrieved_at: c.retrieved_at, judge: c.judge || null, made_up_figures: c.made_up_figures || [] })) }] });
      result.stored = 'account';
    } catch (e) { result.stored_note = e && e.code === 'no_table' ? 'This run was not kept: the evaluation table is not in this database yet, so runs cannot be compared.' : 'This run was not kept: the store did not answer.'; }
  } else result.stored_note = 'This run was not kept: the brand has no workspace on the server, so runs cannot be compared.';
  return result;
}

// Worse than the last run by more than a tenth of the scale is a regression.
function compare(now, prevRow) {
  if (!prevRow || !prevRow.scores) return { previous: null, note: 'First run kept: nothing to compare with yet.' };
  const p = prevRow.scores; const out = { previous: prevRow.created_at, regressed: [], improved: [] };
  const pair = (label, a, c, tol) => { if (a == null || c == null) return; if (a < c - tol) out.regressed.push({ metric: label, was: c, now: a }); else if (a > c + tol) out.improved.push({ metric: label, was: c, now: a }); };
  pair('retrieval rate', now.retrieval.rate, p.retrieval && p.retrieval.rate, 0.1);
  pair('judge: grounded', now.judge.grounded, p.judge && p.judge.grounded, 0.5);
  pair('judge: relevant', now.judge.relevant, p.judge && p.judge.relevant, 0.5);
  return out;
}

async function list({ workspaceId, limit } = {}) {
  if (!KIT.isUuid(workspaceId)) return { runs: [], stored: 'none', note: 'No runs are kept for a brand with no workspace on the server.' };
  try {
    const rows = await KIT.svc(`ai_eval_runs?workspace_id=eq.${workspaceId}&select=id,scores,created_at&order=created_at.desc&limit=${Math.max(1, Math.min(30, Number(limit) || 10))}`);
    return { runs: Array.isArray(rows) ? rows : [], stored: 'account' };
  } catch (e) { return { runs: [], stored: 'none', note: e && e.code === 'no_table' ? 'The evaluation table is not in this database yet.' : 'The store did not answer.' }; }
}

module.exports = { run, list, testSet, compare, figures };
