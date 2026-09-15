'use strict';
/**
 * selfhost-compose.js — the ONE implementation behind the self-host kit.
 * ---------------------------------------------------------------------------
 * Everything in `scripts/selfhost-*` and `tests/self-hosted-supabase.spec.js`
 * that reasons about the kit goes through here, so the migration order the
 * shell applier walks IS the order the test executes, and the connection
 * strings the test inspects are rendered by the same substitution rules
 * Compose applies. A second copy of any of these in a shell script would be a
 * second thing to drift.
 *
 *   parseEnv(text)            .env → { KEY: value }
 *   parseYaml(text)           the Compose subset this kit uses (no anchors/tags)
 *   interpolate(str, env)     ${VAR} ${VAR:-d} ${VAR-d} ${VAR:?e} $$ — Compose rules
 *   collectRefs(doc)          every ${VAR} a document references, with defaults
 *   render(doc, env)          the document with every string interpolated
 *   dbTargets(renderedDoc)    per service: which host + ssl mode it will dial
 *   migrationOrder(dir)       supabase/migrations/*.sql in TIMESTAMP order
 *   splitSql(text)            statements, respecting $$ bodies and quotes
 *   guardReport(text)         is every CREATE in this SQL idempotent-guarded?
 *
 * No dependencies: this repo ships no YAML or SQL library and the kit must run
 * on a bare `node`.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ── .env ─────────────────────────────────────────────────────────────── */

function parseEnv(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*export\s+/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (/^"/.test(val)) {
      const m = val.match(/^"((?:\\.|[^"\\])*)"/);
      val = m ? m[1].replace(/\\n/g, '\n').replace(/\\(.)/g, '$1') : val.slice(1);
    } else if (/^'/.test(val)) {
      const m = val.match(/^'([^']*)'/);
      val = m ? m[1] : val.slice(1);
    } else {
      val = val.replace(/\s+#.*$/, '').trim();
    }
    out[key] = val;
  }
  return out;
}

/* ── YAML (the Compose subset) ─────────────────────────────────────────── */
//
// Block mappings, block sequences, `- key: value` items, double/single quoted
// scalars, flow sequences of scalars, empty flow maps, `|` literal blocks and
// comments. Anchors, aliases and tags are refused loudly: a file that needs
// them is a file this parser cannot be trusted with, and a silent misparse
// would let the test pass on a compose file Compose itself reads differently.

function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).replace(/\s+$/, '');
  }
  return s.replace(/\s+$/, '');
}

function scalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return s === '' ? '' : null;
  if (s[0] === '"') {
    const m = s.match(/^"((?:\\.|[^"\\])*)"\s*$/);
    if (!m) throw new Error(`yaml: unterminated double-quoted scalar: ${raw}`);
    return m[1].replace(/\\(["\\nt])/g, (_, c) => ({ '"': '"', '\\': '\\', n: '\n', t: '\t' }[c]));
  }
  if (s[0] === "'") {
    const m = s.match(/^'((?:''|[^'])*)'\s*$/);
    if (!m) throw new Error(`yaml: unterminated single-quoted scalar: ${raw}`);
    return m[1].replace(/''/g, "'");
  }
  if (s[0] === '[') {
    const m = s.match(/^\[(.*)\]\s*$/);
    if (!m) throw new Error(`yaml: unterminated flow sequence: ${raw}`);
    return splitFlow(m[1]).map(scalar);
  }
  if (s[0] === '{') {
    if (/^\{\s*\}$/.test(s)) return {};
    throw new Error(`yaml: flow mappings are not supported: ${raw}`);
  }
  if (s[0] === '&' || s[0] === '*' || s[0] === '!') {
    throw new Error(`yaml: anchors, aliases and tags are not supported: ${raw}`);
  }
  return s;
}

function splitFlow(inner) {
  const items = [];
  let cur = '', q = null;
  for (const c of inner) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === ',') { items.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') items.push(cur);
  return items.map((x) => x.trim()).filter((x) => x !== '');
}

/** Where does `key: value` split? Never inside quotes, never on `://`. */
function keySplit(content) {
  if (/^["'\[{]/.test(content)) return null;
  const m = content.match(/^([^\s:][^:]*?)\s*:(?:\s+|$)/);
  if (!m) return null;
  return { key: m[1].trim(), rest: content.slice(m[0].length) };
}

function parseYaml(text) {
  const lines = [];
  String(text).split(/\r?\n/).forEach((raw, n) => {
    if (raw.includes('\t')) throw new Error(`yaml: tab on line ${n + 1}`);
    const content = stripComment(raw);
    if (!content.trim()) return;
    lines.push({ n: n + 1, indent: raw.match(/^ */)[0].length, content: content.trim() });
  });
  let pos = 0;

  function parseBlock(indent) {
    if (pos >= lines.length) return null;
    const first = lines[pos];
    if (first.indent !== indent) return null;
    return /^-(\s|$)/.test(first.content) ? parseSeq(indent) : parseMap(indent);
  }

  function literalBlock(parentIndent) {
    const out = [];
    let base = null;
    while (pos < lines.length && lines[pos].indent > parentIndent) {
      if (base === null) base = lines[pos].indent;
      out.push(' '.repeat(Math.max(0, lines[pos].indent - base)) + lines[pos].content);
      pos++;
    }
    return out.join('\n') + '\n';
  }

  function valueAfter(rest, indent) {
    if (rest === '' ) {
      // nested block, or an empty value
      if (pos < lines.length && lines[pos].indent > indent) return parseBlock(lines[pos].indent);
      return '';
    }
    if (rest === '|' || rest === '|-' || rest === '>' || rest === '>-') {
      const body = literalBlock(indent);
      return rest.startsWith('>') ? body.replace(/\n(?!\n)/g, ' ').trim() : body;
    }
    return scalar(rest);
  }

  function parseMap(indent) {
    const obj = {};
    while (pos < lines.length && lines[pos].indent === indent) {
      const { content, n } = lines[pos];
      if (/^-(\s|$)/.test(content)) break;
      const kv = keySplit(content);
      if (!kv) throw new Error(`yaml: expected "key: value" on line ${n}: ${content}`);
      pos++;
      if (Object.prototype.hasOwnProperty.call(obj, kv.key)) throw new Error(`yaml: duplicate key "${kv.key}" on line ${n}`);
      obj[kv.key] = valueAfter(kv.rest, indent);
    }
    return obj;
  }

  function parseSeq(indent) {
    const arr = [];
    while (pos < lines.length && lines[pos].indent === indent && /^-(\s|$)/.test(lines[pos].content)) {
      const { content } = lines[pos];
      const rest = content.replace(/^-\s*/, '');
      pos++;
      if (rest === '') { arr.push(pos < lines.length && lines[pos].indent > indent ? parseBlock(lines[pos].indent) : null); continue; }
      const kv = keySplit(rest);
      if (kv) {
        // `- key: value` opens a mapping whose remaining keys sit at indent+2
        const itemIndent = indent + 2;
        const obj = {};
        obj[kv.key] = valueAfter(kv.rest, itemIndent);
        if (pos < lines.length && lines[pos].indent === itemIndent && !/^-(\s|$)/.test(lines[pos].content)) {
          Object.assign(obj, parseMap(itemIndent));
        }
        arr.push(obj);
      } else {
        arr.push(scalar(rest));
      }
    }
    return arr;
  }

  const doc = parseBlock(lines.length ? lines[0].indent : 0);
  if (pos < lines.length) throw new Error(`yaml: unexpected content on line ${lines[pos].n}: ${lines[pos].content}`);
  return doc;
}

/* ── Compose interpolation ─────────────────────────────────────────────── */

const REF = /\$(?:\$|\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])((?:[^{}]|\{[^{}]*\})*))?\}|([A-Za-z_][A-Za-z0-9_]*))/g;

function interpolate(str, env) {
  return String(str).replace(REF, (m, name, op, arg, bare) => {
    if (m === '$$') return '$';
    const key = name || bare;
    const val = env[key];
    const unset = val === undefined;
    const empty = unset || val === '';
    if (!op) return unset ? '' : val;
    const fallback = () => interpolate(arg, env);
    if (op === ':-') return empty ? fallback() : val;
    if (op === '-') return unset ? fallback() : val;
    if (op === ':?') { if (empty) throw new Error(`required variable ${key} is missing: ${arg}`); return val; }
    if (op === '?') { if (unset) throw new Error(`required variable ${key} is missing: ${arg}`); return val; }
    return m;
  });
}

function collectRefs(doc, out = new Map()) {
  if (typeof doc === 'string') {
    for (const m of doc.matchAll(REF)) {
      if (m[0] === '$$') continue;
      const key = m[1] || m[4];
      const prev = out.get(key) || { name: key, hasDefault: false };
      prev.hasDefault = prev.hasDefault || (m[2] === ':-' || m[2] === '-');
      out.set(key, prev);
      if (m[3]) collectRefs(m[3], out);
    }
  } else if (Array.isArray(doc)) doc.forEach((x) => collectRefs(x, out));
  else if (doc && typeof doc === 'object') Object.values(doc).forEach((x) => collectRefs(x, out));
  return out;
}

function render(doc, env) {
  if (typeof doc === 'string') return interpolate(doc, env);
  if (Array.isArray(doc)) return doc.map((x) => render(x, env));
  if (doc && typeof doc === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(doc)) o[k] = render(v, env);
    return o;
  }
  return doc;
}

/* ── which host will each service dial? ───────────────────────────────── */

function parsePgUrl(u) {
  const url = new URL(u);
  return {
    user: decodeURIComponent(url.username),
    host: url.hostname,
    port: url.port,
    db: url.pathname.replace(/^\//, ''),
    sslmode: url.searchParams.get('sslmode'),
  };
}

/**
 * One row per service that opens a Postgres connection, read from the SAME
 * environment keys each service documents (GOTRUE_DB_DATABASE_URL, PGRST_DB_URI,
 * DATABASE_URL, DB_HOST/DB_SSL, PG_META_DB_HOST/PG_META_DB_SSL_MODE).
 */
function dbTargets(rendered) {
  const s = rendered.services || {};
  const env = (name) => (s[name] && s[name].environment) || {};
  const rows = [];
  if (s.auth) { const t = parsePgUrl(env('auth').GOTRUE_DB_DATABASE_URL); rows.push({ service: 'auth', ...t, secure: t.sslmode }); }
  if (s.rest) { const t = parsePgUrl(env('rest').PGRST_DB_URI); rows.push({ service: 'rest', ...t, secure: t.sslmode }); }
  if (s.storage) { const t = parsePgUrl(env('storage').DATABASE_URL); rows.push({ service: 'storage', ...t, secure: t.sslmode }); }
  if (s.realtime) {
    const e = env('realtime');
    rows.push({ service: 'realtime', user: e.DB_USER, host: e.DB_HOST, port: e.DB_PORT, db: e.DB_NAME, sslmode: null, secure: String(e.DB_SSL) === 'true' ? 'require' : 'disable' });
  }
  if (s.meta) {
    const e = env('meta');
    rows.push({ service: 'meta', user: e.PG_META_DB_USER, host: e.PG_META_DB_HOST, port: e.PG_META_DB_PORT, db: e.PG_META_DB_NAME, sslmode: e.PG_META_DB_SSL_MODE, secure: e.PG_META_DB_SSL_MODE });
  }
  if (s.studio) {
    const e = env('studio');
    rows.push({ service: 'studio', user: e.POSTGRES_USER_READ_WRITE, host: e.POSTGRES_HOST, port: e.POSTGRES_PORT, db: e.POSTGRES_DB, sslmode: null, secure: null });
  }
  return rows;
}

/* ── migrations: timestamp order ───────────────────────────────────────── */

/**
 * The files carry two prefix shapes — `20260429120000_` (14 digits) and
 * `20260527_` (8 digits, midnight implied). Plain name order sorts
 * `20260719_ci_subscriptions.sql` AFTER `20260719140000_…` because `_` is
 * greater than any digit; timestamp order puts it first (00:00 < 14:00).
 * The short prefix is right-padded with zeros to 14 digits, then files sort
 * by that version and by name within a version.
 */
function migrationVersion(file) {
  const m = file.match(/^(\d{8}|\d{14})_.*\.sql$/);
  if (!m) return null;
  return m[1].padEnd(14, '0');
}

function migrationOrder(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const rows = [];
  for (const f of files) {
    const version = migrationVersion(f);
    if (!version) throw new Error(`migration file has no timestamp prefix: ${f}`);
    rows.push({ file: f, version });
  }
  rows.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return rows;
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/* ── SQL: statements and idempotency guards ────────────────────────────── */

/** Split on `;` outside quotes, comments and dollar-quoted bodies. */
function splitSql(text) {
  const out = [];
  let cur = '', i = 0;
  const s = String(text);
  while (i < s.length) {
    const c = s[i];
    if (c === '-' && s[i + 1] === '-') { const e = s.indexOf('\n', i); const seg = e < 0 ? s.slice(i) : s.slice(i, e); cur += seg; i += seg.length; continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); const seg = s.slice(i, e < 0 ? s.length : e + 2); cur += seg; i += seg.length; continue; }
    if (c === "'") { let j = i + 1; while (j < s.length) { if (s[j] === "'" && s[j + 1] === "'") { j += 2; continue; } if (s[j] === "'") break; j++; } cur += s.slice(i, j + 1); i = j + 1; continue; }
    if (c === '$') {
      const m = s.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m) { const tag = m[0]; const e = s.indexOf(tag, i + tag.length); const seg = s.slice(i, e < 0 ? s.length : e + tag.length); cur += seg; i += seg.length; continue; }
    }
    if (c === ';') { out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((x) => x.replace(/--[^\n]*/g, '').trim() !== '');
}

const stripSqlComments = (s) => s.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * Every CREATE (and ALTER … ADD) must be guarded so the file re-runs cleanly:
 *   - a top-level statement carries IF NOT EXISTS or OR REPLACE, or
 *   - it sits inside a DO block, within an `IF NOT EXISTS (…) THEN … END IF`
 *     region or a `BEGIN … EXCEPTION WHEN … END` region.
 * Returns { total, guarded, unguarded: [snippet] }.
 */
function guardReport(text) {
  const report = { total: 0, guarded: 0, unguarded: [] };
  for (const stmt of splitSql(text)) {
    const body = stripSqlComments(stmt);
    const head = body.trim().toLowerCase();
    if (/^do\b/.test(head)) {
      const inner = body.match(/\$([A-Za-z_]*)\$([\s\S]*)\$\1\$/);
      if (!inner) continue;
      checkDoBody(inner[2], report);
      continue;
    }
    if (/^create\b/.test(head)) {
      report.total++;
      if (/\bif\s+not\s+exists\b/.test(head) || /^create\s+or\s+replace\b/.test(head)) report.guarded++;
      else report.unguarded.push(stmt.slice(0, 90));
    }
  }
  return report;
}

function checkDoBody(bodyText, report) {
  // Region tracking over a token stream. `if not exists (` opens an IF guard
  // closed by `end if`; a nested `begin … end` is a guard when it carries an
  // EXCEPTION clause (decided by a pre-pass over balanced begin/end pairs).
  const toks = bodyText.toLowerCase().match(/[a-z_]+|\(|\)|;|'(?:[^']|'')*'/g) || [];
  const stack = [];
  const beginGuarded = new Map();
  // pre-pass: which BEGIN blocks contain EXCEPTION
  (function prepass() {
    const opens = [];
    for (let i = 0; i < toks.length; i++) {
      if (toks[i] === 'begin') opens.push({ i, exc: false });
      else if (toks[i] === 'exception' && opens.length) opens[opens.length - 1].exc = true;
      else if (toks[i] === 'end' && toks[i + 1] !== 'if' && toks[i + 1] !== 'loop' && toks[i + 1] !== 'case') {
        const o = opens.pop(); if (o) beginGuarded.set(o.i, o.exc);
      }
    }
  })();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === 'begin') { stack.push(beginGuarded.get(i) ? 'guard' : 'begin'); continue; }
    if (t === 'if') {
      const guard = toks[i + 1] === 'not' && toks[i + 2] === 'exists';
      const notFound = toks[i + 1] === 'not' && toks[i + 2] === 'found';
      stack.push(guard || notFound ? 'guard' : 'if');
      continue;
    }
    if (t === 'end') {
      if (toks[i + 1] === 'if') { popKind(stack, ['guard', 'if']); i++; continue; }
      if (toks[i + 1] === 'loop' || toks[i + 1] === 'case') { i++; continue; }
      popKind(stack, ['guard', 'begin']);
      continue;
    }
    if (t === 'loop') { /* LOOP … END LOOP carries no guard */ continue; }
    // a CREATE statement, spelled directly or inside an EXECUTE string
    const startsCreate = (t === 'create' && (i === 0 || [';', 'then', 'begin', 'else', 'loop'].includes(toks[i - 1])))
      || (t.startsWith("'") && /^'\s*create\b/.test(t))
      || (t.startsWith("'") && /^'\s*alter\s+publication\b[^']*\badd\b/.test(t));
    if (startsCreate) {
      report.total++;
      if (stack.includes('guard') || /\bif\s+not\s+exists\b/.test(t)) report.guarded++;
      else report.unguarded.push('DO: ' + toks.slice(i, i + 8).join(' '));
    }
  }
}

function popKind(stack, kinds) {
  for (let j = stack.length - 1; j >= 0; j--) {
    if (kinds.includes(stack[j])) { stack.splice(j, 1); return; }
  }
}

/* ── kit paths ─────────────────────────────────────────────────────────── */

const ROOT = path.resolve(__dirname, '..', '..');
const KIT = path.join(ROOT, 'selfhost');
const PATHS = {
  root: ROOT,
  kit: KIT,
  compose: path.join(KIT, 'docker-compose.yml'),
  envExample: path.join(KIT, '.env.example'),
  env: path.join(KIT, '.env'),
  migrations: path.join(ROOT, 'supabase', 'migrations'),
  seeds: path.join(ROOT, 'supabase', 'seed'),
  bootstrap: path.join(ROOT, 'scripts', 'selfhost-bootstrap-db.sql'),
};

/** The kit's .env (or .env.example when asked), parsed. SELFHOST_ENV overrides the path. */
function loadKitEnv({ example = false } = {}) {
  const p = example ? PATHS.envExample : (process.env.SELFHOST_ENV || PATHS.env);
  if (!fs.existsSync(p)) throw new Error(`${p} not found${example ? '' : ' — copy selfhost/.env.example to selfhost/.env first'}`);
  return parseEnv(fs.readFileSync(p, 'utf8'));
}

/** local | external, decided by DB_MODE, cross-checked against POSTGRES_HOST. */
function dbMode(env) {
  const mode = String(env.DB_MODE || 'local').toLowerCase();
  if (mode !== 'local' && mode !== 'external') throw new Error(`DB_MODE must be local or external, got "${env.DB_MODE}"`);
  const problems = [];
  if (mode === 'local' && env.POSTGRES_HOST && env.POSTGRES_HOST !== 'db') problems.push(`DB_MODE=local but POSTGRES_HOST=${env.POSTGRES_HOST} (the local container is "db")`);
  if (mode === 'external') {
    if (!env.POSTGRES_HOST || env.POSTGRES_HOST === 'db') problems.push('DB_MODE=external but POSTGRES_HOST is unset or still "db"');
    if (env.POSTGRES_SSLMODE !== 'require' && env.POSTGRES_SSLMODE !== 'verify-full') problems.push(`DB_MODE=external needs POSTGRES_SSLMODE=require (Neon refuses plain connections), got "${env.POSTGRES_SSLMODE}"`);
    if (String(env.REALTIME_DB_SSL) !== 'true') problems.push('DB_MODE=external needs REALTIME_DB_SSL=true');
    if (String(env.STORAGE_DB_INSTALL_ROLES) !== 'false') problems.push('DB_MODE=external needs STORAGE_DB_INSTALL_ROLES=false (the bootstrap SQL creates the roles; storage-api\'s installer assumes a superuser)');
    for (const k of ['AUTH_DB_USER', 'STORAGE_DB_USER', 'REALTIME_DB_USER', 'META_DB_USER', 'STUDIO_DB_USER', 'STORAGE_DB_SUPER_USER']) {
      if (!env[k]) problems.push(`DB_MODE=external needs ${k} set to your managed-Postgres role (usually the same as POSTGRES_USER)`);
    }
  }
  return { mode, problems };
}

module.exports = {
  parseEnv, parseYaml, interpolate, collectRefs, render, dbTargets, parsePgUrl,
  migrationVersion, migrationOrder, sha256File, splitSql, guardReport,
  PATHS, loadKitEnv, dbMode,
};

/* CLI: node scripts/lib/selfhost-compose.js migrations  → ordered list, one per line */
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'migrations') {
    for (const r of migrationOrder(PATHS.migrations)) process.stdout.write(r.file + '\n');
  } else if (cmd === 'mode') {
    const env = loadKitEnv();
    const m = dbMode(env);
    process.stdout.write(m.mode + '\n');
    if (m.problems.length) { m.problems.forEach((p) => process.stderr.write('  ! ' + p + '\n')); process.exit(2); }
  } else if (cmd === 'env') {
    // shell-safe `export KEY='value'` lines, so the bash scripts never re-parse .env themselves
    const env = loadKitEnv();
    for (const [k, v] of Object.entries(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
      process.stdout.write(`export ${k}='${String(v).replace(/'/g, "'\\''")}'\n`);
    }
  } else {
    process.stderr.write('usage: node scripts/lib/selfhost-compose.js migrations|mode|env\n');
    process.exit(64);
  }
}
