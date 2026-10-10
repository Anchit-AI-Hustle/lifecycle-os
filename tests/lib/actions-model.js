'use strict';
/**
 * actions-model.js - a model of the two parts of GitHub Actions that this
 * repository's workflow guarantees rest on, so a spec can EVALUATE a workflow
 * file instead of grepping it:
 *
 *   1. the expression language (`if:`, `concurrency:`), and
 *   2. which event starts which workflow (`on:` filters, and the GITHUB_TOKEN
 *      recursion guard).
 *
 * Written from GitHub's own documentation, github/docs at 2bd66de
 * (2026-10-02): content/actions/reference/workflows-and-actions/
 * expressions.md and events-that-trigger-workflows.md, and
 * data/reusables/actions/actions-do-not-trigger-workflows.md. A model can be
 * wrong, and a wrong model would make a wrong workflow look right, so the spec
 * that uses this first runs it over the documentation's OWN examples (the
 * vercel-deploy-quota precedent) and fails before it trusts it.
 *
 * WHAT IT REFUSES TO GUESS. A trigger key it does not model (`paths:`, `tags:`)
 * throws instead of being ignored, and so does an `if:` that mixes `${{ }}`
 * with plain text, `hashFiles()`, and a status function in a context that has
 * no status. A model that silently ignored a filter would report "starts" for
 * a workflow that GitHub would not start.
 */
const { minimatch } = require('minimatch');

// ── 1. Expressions ──────────────────────────────────────────────────────────

/** What `*` returns: a collection whose property de-reference maps over it. */
class Filtered extends Array {}

const kindOf = (v) => (v === null || v === undefined ? 'null'
  : Array.isArray(v) ? 'array'
    : typeof v === 'object' ? 'object'
      : typeof v);

/** docs: falsy values (false, 0, -0, "", '', null) are coerced to false. */
const truthy = (v) => !(v === false || v === 0 || v === '' || v === null || v === undefined);

/** docs: Null -> 0; true -> 1, false -> 0; String -> any legal JSON number, '' -> 0, else NaN; Array/Object -> NaN. */
function toNumber(v) {
  switch (kindOf(v)) {
    case 'null': return 0;
    case 'boolean': return v ? 1 : 0;
    case 'number': return v;
    case 'string': {
      const s = v.trim();
      if (s === '') return 0;
      return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s) ? Number(s) : NaN;
    }
    default: return NaN;
  }
}

/** docs: Null -> ''; Boolean -> 'true'/'false'; Number -> decimal; arrays and objects are not converted. */
function toStr(v) {
  switch (kindOf(v)) {
    case 'null': return '';
    case 'boolean': return v ? 'true' : 'false';
    case 'number': return String(v);
    case 'string': return v;
    default: throw new TypeError('arrays and objects are not converted to a string');
  }
}

/** docs: loose equality; mismatched types coerce to number; strings ignore case; arrays/objects equal only as the same instance. */
function looseEqual(a, b) {
  const ka = kindOf(a); const kb = kindOf(b);
  if (ka !== kb) return toNumber(a) === toNumber(b);
  if (ka === 'string') return a.toUpperCase() === b.toUpperCase();
  if (ka === 'null') return true;
  return a === b;
}

/** docs: NaN on either side of a relational comparison is always false. */
function relational(op, a, b) {
  let x; let y;
  if (kindOf(a) === 'string' && kindOf(b) === 'string') { x = a.toUpperCase(); y = b.toUpperCase(); }
  else {
    x = toNumber(a); y = toNumber(b);
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
  }
  return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
}

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") {
      let s = '';
      i++;
      for (;;) {
        if (i >= src.length) throw new SyntaxError(`unterminated string in: ${src}`);
        if (src[i] === "'") {
          if (src[i + 1] === "'") { s += "'"; i += 2; continue; }
          i++;
          break;
        }
        s += src[i++];
      }
      out.push({ k: 'lit', v: s });
      continue;
    }
    if (c === '"') throw new SyntaxError(`docs: wrapping a string with double quotes throws an error: ${src}`);
    if (c === '-' || /\d/.test(c)) {
      const m = /^-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
      if (!m) throw new SyntaxError(`bad number at ${i} in: ${src}`);
      const t = m[0];
      const neg = t.startsWith('-');
      const body = neg ? t.slice(1) : t;
      const n = /^0x/i.test(body) ? parseInt(body, 16) : Number(body);
      out.push({ k: 'lit', v: neg ? -n : n });
      i += t.length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { out.push({ k: 'op', v: two }); i += 2; continue; }
    if ('()[].,!<>*'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(src.slice(i));
    if (id) {
      const w = id[0];
      if (w === 'true' || w === 'false') out.push({ k: 'lit', v: w === 'true' });
      else if (w === 'null') out.push({ k: 'lit', v: null });
      else out.push({ k: 'id', v: w });
      i += w.length;
      continue;
    }
    throw new SyntaxError(`unexpected '${c}' at ${i} in: ${src}`);
  }
  return out;
}

/** Precedence, lowest first, as the docs' operator table lists it in reverse: || && (== !=) (< <= > >=) ! then [ ] . ( ). */
function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = (v) => toks[p] && toks[p].k === 'op' && toks[p].v === v;
  const take = (v) => { if (!peek(v)) throw new SyntaxError(`expected '${v}' at token ${p} in: ${src}`); p++; };

  function primary() {
    const t = toks[p++];
    if (!t) throw new SyntaxError(`unexpected end of: ${src}`);
    if (t.k === 'lit') return { t: 'lit', v: t.v };
    if (t.k === 'op' && t.v === '(') { const e = or(); take(')'); return e; }
    if (t.k === 'id') {
      if (peek('(')) {
        p++;
        const args = [];
        if (!peek(')')) { args.push(or()); while (peek(',')) { p++; args.push(or()); } }
        take(')');
        return { t: 'call', name: t.v, args };
      }
      return { t: 'ctx', name: t.v };
    }
    throw new SyntaxError(`unexpected '${t.v}' in: ${src}`);
  }
  function postfix() {
    let e = primary();
    for (;;) {
      if (peek('.')) {
        p++;
        if (peek('*')) { p++; e = { t: 'star', obj: e }; continue; }
        const t = toks[p++];
        if (!t || t.k !== 'id') throw new SyntaxError(`expected a property name after '.' in: ${src}`);
        e = { t: 'index', obj: e, key: { t: 'lit', v: t.v } };
        continue;
      }
      if (peek('[')) {
        p++;
        if (peek('*')) { p++; take(']'); e = { t: 'star', obj: e }; continue; }
        const key = or();
        take(']');
        e = { t: 'index', obj: e, key };
        continue;
      }
      return e;
    }
  }
  function unary() { if (peek('!')) { p++; return { t: 'not', x: unary() }; } return postfix(); }
  function rel() {
    let l = unary();
    while (['<', '<=', '>', '>='].some(peek)) { const op = toks[p++].v; l = { t: 'rel', op, l, r: unary() }; }
    return l;
  }
  function eq() {
    let l = rel();
    while (peek('==') || peek('!=')) { const op = toks[p++].v; l = { t: 'eq', op, l, r: rel() }; }
    return l;
  }
  function and() { let l = eq(); while (peek('&&')) { p++; l = { t: 'and', l, r: eq() }; } return l; }
  function or() { let l = and(); while (peek('||')) { p++; l = { t: 'or', l, r: and() }; } return l; }

  const ast = or();
  if (p !== toks.length) throw new SyntaxError(`trailing tokens in: ${src}`);
  return ast;
}

function deref(obj, key) {
  if (obj instanceof Filtered) {
    const out = new Filtered();
    for (const item of obj) { const v = deref(item, key); if (v !== null) out.push(v); }
    return out;
  }
  if (Array.isArray(obj)) {
    const n = toNumber(key);
    return Number.isInteger(n) && n >= 0 && n < obj.length ? obj[n] : null;
  }
  if (kindOf(obj) === 'object') {
    const k = toStr(key);
    return Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined ? obj[k] : null;
  }
  return null;
}

/** docs, Object filters: `*` on an array selects its items, on an object its values. */
function star(obj) {
  const out = new Filtered();
  const items = obj instanceof Filtered
    ? obj.flatMap((x) => (Array.isArray(x) ? x : kindOf(x) === 'object' ? Object.values(x) : []))
    : Array.isArray(obj) ? obj : kindOf(obj) === 'object' ? Object.values(obj) : [];
  out.push(...items);
  return out;
}

const plain = (v) => (v instanceof Filtered ? Array.from(v, plain) : Array.isArray(v) ? v.map(plain)
  : kindOf(v) === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);

const STATUS_FUNCTIONS = new Set(['success', 'always', 'cancelled', 'failure']);

function callFunction(name, args, status) {
  const ci = (v) => toStr(v).toUpperCase();
  switch (name.toLowerCase()) {
    case 'contains': {
      const [search, item] = args;
      if (Array.isArray(search)) {
        return search.some((e) => !['array', 'object'].includes(kindOf(e)) && !['array', 'object'].includes(kindOf(item)) && ci(e) === ci(item));
      }
      return ci(search).includes(ci(item));
    }
    case 'startswith': return ci(args[0]).startsWith(ci(args[1]));
    case 'endswith': return ci(args[0]).endsWith(ci(args[1]));
    case 'format': {
      const [fmt, ...vals] = args;
      return toStr(fmt).replace(/\{\{|\}\}|\{(\d+)\}/g, (m, n) => {
        if (m === '{{') return '{';
        if (m === '}}') return '}';
        if (Number(n) >= vals.length) throw new RangeError(`format: no argument {${n}}`);
        return toStr(vals[Number(n)]);
      });
    }
    case 'join': {
      const [arr, sep] = args;
      const s = args.length > 1 ? toStr(sep) : ',';
      return Array.isArray(arr) ? arr.filter((x) => !['array', 'object'].includes(kindOf(x))).map(toStr).join(s) : toStr(arr);
    }
    case 'tojson': return JSON.stringify(plain(args[0]), null, 2);
    case 'fromjson': return JSON.parse(toStr(args[0]));
    case 'case': {
      if (args.length < 3 || args.length % 2 === 0) throw new SyntaxError('case() takes predicate/value pairs and a default');
      for (let i = 0; i + 1 < args.length; i += 2) if (truthy(args[i])) return args[i + 1];
      return args[args.length - 1];
    }
    case 'hashfiles': throw new Error('hashFiles() reads the workspace and is not modelled');
    default: break;
  }
  if (STATUS_FUNCTIONS.has(name.toLowerCase())) {
    if (!status) throw new Error(`${name}() is a status function and this evaluation has no status`);
    const results = Object.values(status.needs || {});
    switch (name.toLowerCase()) {
      case 'always': return true;
      case 'cancelled': return !!status.cancelled;
      // docs: failure() is true if any ancestor job fails (only direct needs are modelled).
      case 'failure': return results.includes('failure');
      default: return !status.cancelled && results.every((r) => r === 'success');
    }
  }
  throw new Error(`function ${name}() is not modelled`);
}

function evaluateAst(node, contexts, status) {
  const ev = (n) => evaluateAst(n, contexts, status);
  switch (node.t) {
    case 'lit': return node.v;
    case 'ctx': return Object.prototype.hasOwnProperty.call(contexts, node.name) ? contexts[node.name] : null;
    case 'index': return deref(ev(node.obj), ev(node.key));
    case 'star': return star(ev(node.obj));
    case 'not': return !truthy(ev(node.x));
    case 'and': { const l = ev(node.l); return truthy(l) ? ev(node.r) : l; }
    case 'or': { const l = ev(node.l); return truthy(l) ? l : ev(node.r); }
    case 'eq': { const r = looseEqual(ev(node.l), ev(node.r)); return node.op === '==' ? r : !r; }
    case 'rel': return relational(node.op, ev(node.l), ev(node.r));
    case 'call': return callFunction(node.name, node.args.map(ev), status);
    default: throw new Error(`unknown node ${node.t}`);
  }
}

const walk = (n, out = []) => {
  out.push(n);
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) v.forEach((x) => x && typeof x === 'object' && x.t && walk(x, out));
    else if (v && typeof v === 'object' && v.t) walk(v, out);
  }
  return out;
};

/** The text inside one `${{ }}`, or the text itself; a mix of the two is a string GitHub does not evaluate. */
function expressionSource(text) {
  const s = String(text).trim();
  const m = /^\$\{\{([\s\S]*)\}\}$/.exec(s);
  if (m && !m[1].includes('${{') && !m[1].includes('}}')) return m[1];
  if (s.includes('${{')) throw new Error(`a value that mixes \${{ }} with text is not modelled: ${text}`);
  return s;
}

/** Evaluate one expression (the inside of a `${{ }}`, or a bare one) to its value. */
function evaluate(expr, contexts = {}, status = null) {
  return plain(evaluateAst(parse(expressionSource(expr)), contexts, status));
}

/** A value that may contain `${{ }}` (a `concurrency.group`, an env value): literal text is passed through. */
function interpolate(value, contexts = {}) {
  if (typeof value !== 'string') return value;
  if (!value.includes('${{')) return value;
  const whole = /^\$\{\{([\s\S]*)\}\}$/.exec(value.trim());
  if (whole && !whole[1].includes('${{')) return evaluate(whole[1], contexts);
  return value.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, e) => toStr(evaluate(e, contexts)));
}

/**
 * Does a job (or step) `if:` let it run? docs: "A default status check of
 * success() is applied unless you include one of these functions"; an absent
 * `if` is that default alone.
 */
function ifPasses(ifValue, contexts = {}, status = { cancelled: false, needs: {} }) {
  if (ifValue === undefined || ifValue === null) return callFunction('success', [], status);
  if (typeof ifValue === 'boolean') return ifValue && callFunction('success', [], status);
  const ast = parse(expressionSource(ifValue));
  const hasStatus = walk(ast).some((n) => n.t === 'call' && STATUS_FUNCTIONS.has(n.name.toLowerCase()));
  const value = truthy(evaluateAst(ast, contexts, status));
  return hasStatus ? value : value && callFunction('success', [], status);
}

// ── 2. Which event starts which workflow ────────────────────────────────────

/** The `on:` block. A YAML 1.1 parser reads the bare key `on` as the boolean true. */
function triggersOf(wf) {
  const on = wf.on !== undefined ? wf.on : wf.true !== undefined ? wf.true : wf.True;
  if (typeof on === 'string') return { [on]: {} };
  if (Array.isArray(on)) return Object.fromEntries(on.map((e) => [e, {}]));
  return Object.fromEntries(Object.entries(on || {}).map(([k, v]) => [k, v || {}]));
}

/** Filter keys modelled per event. Any other key throws: ignoring it would over-report "starts". */
const MODELLED_KEYS = {
  push: ['branches', 'branches-ignore'],
  pull_request: ['types', 'branches', 'branches-ignore'],
  workflow_dispatch: ['inputs'],
  repository_dispatch: ['types'],
  workflow_run: ['workflows', 'types', 'branches', 'branches-ignore'],
};

/** docs (actions-do-not-trigger-workflows): only these two start a run when GITHUB_TOKEN caused them. */
const GITHUB_TOKEN_EXEMPT = new Set(['workflow_dispatch', 'repository_dispatch']);

const branchOf = (ref) => String(ref || '').replace(/^refs\/heads\//, '');

/** Ordered include/exclude patterns: `!pattern` excludes, the last matching pattern wins. */
function patternsMatch(patterns, name) {
  let included = false;
  for (const raw of patterns) {
    const p = String(raw);
    const neg = p.startsWith('!');
    if (minimatch(name, neg ? p.slice(1) : p, { dot: true, nonegate: true, nocomment: true })) included = !neg;
  }
  return included;
}

function branchesAllow(cfg, branch) {
  if (cfg.branches && cfg['branches-ignore']) throw new Error('branches and branches-ignore on one event is a workflow error');
  if (cfg.branches) return patternsMatch(cfg.branches, branch);
  if (cfg['branches-ignore']) return !patternsMatch(cfg['branches-ignore'], branch);
  return true;
}

/**
 * Would `event` start a run of `wf` (whose file name is `file`)? Events:
 *   { name:'push', ref, byGithubToken }
 *   { name:'pull_request', action, base, byGithubToken }
 *   { name:'workflow_dispatch', workflowFile, ref, inputs, byGithubToken }
 *   { name:'repository_dispatch', type, byGithubToken }
 *   { name:'workflow_run', workflow, action, headBranch }
 * A `pull_request` caused by GITHUB_TOKEN waits for a human's approval (docs);
 * the model counts that as not started, because nothing runs until a person acts.
 */
function startsRun(wf, file, event) {
  const cfg = triggersOf(wf)[event.name];
  if (cfg === undefined) return false;
  // Before any filter: an event GITHUB_TOKEN caused starts nothing, whatever
  // the filters (`paths:` included) would have said.
  if (event.byGithubToken && !GITHUB_TOKEN_EXEMPT.has(event.name)) return false;
  const known = MODELLED_KEYS[event.name];
  if (!known) throw new Error(`event ${event.name} is not modelled`);
  const unknown = Object.keys(cfg).filter((k) => !known.includes(k));
  if (unknown.length) throw new Error(`${file}: on.${event.name}.${unknown.join(', ')} is not modelled`);
  switch (event.name) {
    case 'push':
      if (!String(event.ref).startsWith('refs/heads/')) return !cfg.branches && !cfg['branches-ignore'];
      return branchesAllow(cfg, branchOf(event.ref));
    case 'pull_request': {
      const types = cfg.types || ['opened', 'synchronize', 'reopened'];
      return types.includes(event.action) && branchesAllow(cfg, event.base);
    }
    case 'workflow_dispatch': {
      // The dispatch names ONE workflow file; undeclared inputs are refused by the API.
      if (event.workflowFile !== file) return false;
      const declared = Object.keys(cfg.inputs || {});
      return Object.keys(event.inputs || {}).every((k) => declared.includes(k));
    }
    case 'repository_dispatch':
      return !cfg.types || cfg.types.includes(event.type);
    case 'workflow_run':
      return (cfg.workflows || []).includes(event.workflow)
        && (!cfg.types || cfg.types.includes(event.action))
        && branchesAllow(cfg, event.headBranch);
    default:
      return false;
  }
}

module.exports = {
  evaluate, interpolate, ifPasses, parse, truthy, looseEqual,
  triggersOf, startsRun, GITHUB_TOKEN_EXEMPT,
};
