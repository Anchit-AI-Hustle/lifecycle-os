#!/usr/bin/env node
'use strict';
/**
 * scripts/coverage/report.js — merge, report and map the untested lines.
 * ---------------------------------------------------------------------------
 * Reads what `npm run coverage` left behind (coverage/tmp = V8 coverage from
 * every Node process, coverage/browser = every Playwright page) and produces:
 *
 *   coverage/lcov.info            c8's lcov for Node-side files + browser hits
 *                                 on external .js, with the inline <script>
 *                                 records of every .html page appended.
 *   coverage/coverage-summary.json  c8's per-file summary (Node side only).
 *   coverage/summary-combined.json  one row per file, both kinds, with the
 *                                 weight and score used for the ranking.
 *   coverage/UNTESTED.md          THE DELIVERABLE: every file with its numbers,
 *                                 and the 25 worst files with their uncovered
 *                                 line ranges and a note per range.
 *
 * `npm run coverage:report` re-runs only this step, so the map can be
 * regenerated without a 10-minute suite run.
 *
 * RANKING. score = uncovered lines × weight. Weight is 2 for a module on the
 * credits / auth / dispatch / preflight / SSRF path (LOAD_BEARING below) and 1
 * otherwise. The printed table is sorted by uncovered lines alone; the
 * ranking in UNTESTED.md is by score. Both are stated where they appear.
 *
 * NOTES PER RANGE are derived, not typed: the innermost function (from V8's
 * own function ranges) that encloses the range, and — when the range is only
 * part of that function — its first line of code. A file no test ever loaded
 * gets its top-level declarations instead, so a follow-up has a starting
 * point without opening the file.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const browser = require('./browser');

const ROOT = browser.ROOT;
const COV = path.join(ROOT, 'coverage');
const TMP = path.join(COV, 'tmp');
const BROWSER = path.join(COV, 'browser');
const WORST = 25;

/**
 * Load-bearing = on the credits, auth, dispatch, preflight or SSRF path. A
 * missed line there is a missed gate, so these count double in the ranking.
 * Matched against the repo-relative path.
 */
const LOAD_BEARING = [
  // credits
  /credit/, /payments-core/, /payments\.html$/,
  // auth / caller identity / secrets
  /^auth\.js$/, /require-caller/, /oauth-core/, /request-scope/, /workspace-scope/,
  /^api\/_shared\/supa\.js$/, /public-config/, /workspace-connections-core/, /brand-connections\.html$/,
  /^api\/ai\//, /^api\/brain\.js$/, /^api\/(?:calendar|competitor|kb)\.js$/,
  // dispatch (anything that can leave the building)
  /dispatch-core/, /adapters\//, /live-connectors/, /read-only-egress/, /social-push-core/, /publishing\.html$/,
  // preflight / deliverability gate
  /preflight-core/, /deliverability-core/,
  // SSRF: the fetchers and the one set of scope/robots rules every crawl rides
  /site-crawl/, /kb-url/, /storefront-detect/,
];
const weightOf = (rel) => (LOAD_BEARING.some((re) => re.test(rel)) ? 2 : 1);

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const git = (args) => { try { return cp.execFileSync('git', args, { cwd: ROOT }).toString().trim(); } catch { return ''; } };

function runC8() {
  const bin = path.join(ROOT, 'node_modules', 'c8', 'bin', 'c8.js');
  const r = cp.spawnSync(process.execPath, [bin, 'report'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('c8 report failed (exit ' + r.status + ')');
}

/* ── uncovered-range helpers ─────────────────────────────────────────────── */

function runs(lineCounts) {
  // lineCounts: { line → count } → contiguous runs of count 0, ascending.
  const zero = Object.keys(lineCounts).map(Number).filter((l) => lineCounts[l] === 0).sort((a, b) => a - b);
  const out = [];
  for (const l of zero) {
    const last = out[out.length - 1];
    if (last && l === last.end + 1) last.end = l; else out.push({ start: l, end: l });
  }
  return out;
}

const isCodeLine = (s) => {
  const t = s.trim();
  return t && !/^(\/\/|\/\*|\*|\*\/)/.test(t) && !/^[{}()\[\];,]*$/.test(t);
};
const oneLine = (s, max = 96) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

/** Try to give V8's "(anonymous_N)" a name from the line it is declared on. */
function nameFrom(decl, fallback) {
  if (fallback && !/^\(anonymous_\d+\)$/.test(fallback)) return fallback;
  const t = (decl || '').trim();
  let m;
  if ((m = t.match(/(?:^|[\s,{(])(?:async\s+)?(?:function\s*\*?\s*)?([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/))) return m[1];
  if ((m = t.match(/^(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/))) return m[1];
  if ((m = t.match(/\.(then|catch|finally|map|filter|forEach|reduce|some|every|find|sort|on|once|addEventListener|replace)\s*\(/))) return 'callback in .' + m[1] + '()';
  if ((m = t.match(/\b([A-Za-z_$][\w$.]*)\s*\(\s*(?:async\s*)?(?:function\b|\()/))) return 'callback in ' + m[1] + '()';
  return fallback || '(anonymous)';
}

function enclosing(fns, line) {
  let best = null;
  for (const f of fns) {
    if (f.start <= line && line <= f.end && (!best || (f.end - f.start) < (best.end - best.start))) best = f;
  }
  return best;
}

/** Top-level declarations of a file nobody loaded: the cheapest map of what is in it. */
function topLevelDecls(src) {
  const names = [];
  const seen = new Set();
  const push = (n) => { if (n && !seen.has(n)) { seen.add(n); names.push(n); } };
  for (const line of src.split('\n')) {
    let m;
    if ((m = line.match(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/))) push(m[1] + '()');
    else if ((m = line.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/))) push(m[1] + '()');
    else if ((m = line.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/))) push(m[1]);
    else if ((m = line.match(/^exports\.([A-Za-z_$][\w$]*)\s*=/))) push('exports.' + m[1]);
    else if ((m = line.match(/^class\s+([A-Za-z_$][\w$]*)/))) push('class ' + m[1]);
  }
  const me = src.match(/module\.exports\s*=\s*\{([\s\S]*?)\};?\s*$/m);
  if (me) {
    for (const k of me[1].split(',').map((s) => s.trim().split(/[:\s]/)[0]).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))) push(k);
  }
  return names;
}

/**
 * Describe one file's uncovered ranges.
 * lineCounts: { line → count } for every reportable line; fns: [{name,start,end}]
 */
function describeRanges(relPath, lineCounts, fns, src) {
  const lines = src.split('\n');
  const all = runs(lineCounts);
  const total = Object.keys(lineCounts).length;
  const uncovered = Object.values(lineCounts).filter((c) => c === 0).length;
  const named = fns.map((f) => ({ ...f, name: nameFrom(lines[f.start - 1], f.name) }));

  if (total && uncovered === total) {
    const decls = topLevelDecls(src);
    return {
      wholeFile: true,
      ranges: [{ start: Math.min(...Object.keys(lineCounts).map(Number)), end: Math.max(...Object.keys(lineCounts).map(Number)),
        note: 'never loaded by any test' + (decls.length ? ' — top-level: ' + decls.slice(0, 14).join(', ') + (decls.length > 14 ? ` … (+${decls.length - 14} more)` : '') : '') }],
      short: [], omitted: 0,
    };
  }

  const ranges = [], short = [];
  for (const r of all) {
    const size = r.end - r.start + 1;
    const fn = enclosing(named, r.start);
    let note;
    if (fn && r.start <= fn.start + 0 && r.end >= fn.end) {
      note = '`' + fn.name + '()` never called';
      // several whole functions may sit inside one run - name the others too
      const inside = named.filter((f) => f !== fn && f.start >= r.start && f.end <= r.end && !(f.start >= fn.start && f.end <= fn.end));
      if (inside.length) note += ', also `' + inside.slice(0, 4).map((f) => f.name + '()').join('`, `') + '`' + (inside.length > 4 ? ` (+${inside.length - 4})` : '');
    } else {
      const first = lines.slice(r.start - 1, r.end).find(isCodeLine);
      note = (fn ? 'in `' + fn.name + '()`: ' : '') + (first ? '`' + oneLine(first) + '`' : '(blank/comment lines)');
    }
    if (size >= 3) ranges.push({ start: r.start, end: r.end, note });
    else short.push({ start: r.start, end: r.end, note });
  }
  const CAP = 45;
  const omitted = Math.max(0, ranges.length - CAP);
  return { wholeFile: false, ranges: ranges.slice(0, CAP), short, omitted };
}

/* ── main ────────────────────────────────────────────────────────────────── */

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function lcovForPage(relPath, page) {
  const abs = path.join(ROOT, relPath);
  const out = ['TN:', 'SF:' + abs];
  for (const f of page.fns) out.push(`FN:${f.start},${f.name}`);
  out.push(`FNF:${page.fns.length}`);
  const lines = Object.keys(page.lines).map(Number).sort((a, b) => a - b);
  for (const l of lines) out.push(`DA:${l},${page.lines[l]}`);
  out.push(`LF:${page.total}`, `LH:${page.covered}`, 'end_of_record');
  return out.join('\n') + '\n';
}

function fmtTable(rows, cols) {
  const widths = cols.map((c) => Math.max(c.h.length, ...rows.map((r) => String(c.v(r)).length)));
  const line = (cells) => cells.map((s, i) => (cols[i].right ? String(s).padStart(widths[i]) : String(s).padEnd(widths[i]))).join('  ');
  return [line(cols.map((c) => c.h)), line(widths.map((w) => '-'.repeat(w))), ...rows.map((r) => line(cols.map((c) => c.v(r))))].join('\n');
}

async function main({ print = true } = {}) {
  if (!fs.existsSync(TMP) || !fs.readdirSync(TMP).some((f) => f.endsWith('.json'))) {
    throw new Error('No coverage data in coverage/tmp — run `npm run coverage` first.');
  }
  const run = fs.existsSync(path.join(COV, 'run.json')) ? readJson(path.join(COV, 'run.json')) : null;

  // 1. Browser entries → c8-mergeable V8 files (external .js) + inline page map.
  const b = await browser.process({ tmpDir: TMP, browserDir: BROWSER });

  // 2. c8: merge every V8 file (Node workers + browser externals) and report.
  runC8();
  const summary = readJson(path.join(COV, 'coverage-summary.json'));
  const final = readJson(path.join(COV, 'coverage-final.json'));

  // 3. One row per file, both kinds.
  const rows = [];
  for (const abs of Object.keys(summary)) {
    if (abs === 'total') continue;
    const r = rel(abs);
    const L = summary[abs].lines;
    rows.push({ file: r, kind: 'node', total: L.total, covered: L.covered, uncovered: L.total - L.covered,
      browserToo: b.jsFiles.includes(r), weight: weightOf(r) });
  }
  for (const [r, p] of Object.entries(b.pages)) {
    rows.push({ file: r, kind: 'page', total: p.total, covered: p.covered, uncovered: p.total - p.covered,
      blocks: p.blocks, executedBlocks: p.executedBlocks, weight: weightOf(r) });
  }
  for (const r of rows) { r.pctUncovered = pct(r.uncovered, r.total); r.score = r.uncovered * r.weight; }

  // 4. Append the inline records to c8's lcov so one file carries both kinds.
  const lcovPath = path.join(COV, 'lcov.info');
  const inlineLcov = Object.entries(b.pages).map(([r, p]) => lcovForPage(r, p)).join('');
  fs.appendFileSync(lcovPath, inlineLcov);

  // 5. Totals.
  const sum = (kind, k) => rows.filter((r) => !kind || r.kind === kind).reduce((a, r) => a + r[k], 0);
  const totals = {
    node: { files: rows.filter((r) => r.kind === 'node').length, lines: sum('node', 'total'), covered: sum('node', 'covered') },
    page: { files: rows.filter((r) => r.kind === 'page').length, lines: sum('page', 'total'), covered: sum('page', 'covered') },
    all: { files: rows.length, lines: sum(null, 'total'), covered: sum(null, 'covered') },
  };
  for (const t of Object.values(totals)) t.pct = pct(t.covered, t.lines);

  const combined = { generated: new Date().toISOString(), commit: git(['rev-parse', '--short', 'HEAD']), run, totals,
    browser: { ...b.stats, jsFiles: b.jsFiles, unattributed: b.unattributed }, rows };
  fs.writeFileSync(path.join(COV, 'summary-combined.json'), JSON.stringify(combined, null, 2));

  // 6. UNTESTED.md
  const ranked = [...rows].sort((x, y) => y.score - x.score || y.uncovered - x.uncovered || x.file.localeCompare(y.file));
  const md = [];
  md.push('# Untested lines — the map');
  md.push('');
  md.push(`Generated ${combined.generated} at commit \`${combined.commit}\` by \`npm run coverage\` (regenerate with \`npm run coverage:report\`; do not hand-edit). How it is measured, and what it cannot see: \`docs/coverage.md\`.`);
  if (run) md.push(`Suite: \`${run.args.join(' ')}\` — exit ${run.exitCode}, ${Math.round(run.durationMs / 1000)}s.`);
  md.push('');
  md.push('## Totals');
  md.push('');
  md.push('| scope | files | lines | covered | uncovered | covered % |');
  md.push('|---|---:|---:|---:|---:|---:|');
  md.push(`| Node-side modules (api/, lib/, scripts/lib/, root .js) — c8 | ${totals.node.files} | ${totals.node.lines} | ${totals.node.covered} | ${totals.node.lines - totals.node.covered} | ${totals.node.pct}% |`);
  md.push(`| Inline \`<script>\` in root .html pages — Playwright JS coverage | ${totals.page.files} | ${totals.page.lines} | ${totals.page.covered} | ${totals.page.lines - totals.page.covered} | ${totals.page.pct}% |`);
  md.push(`| **Combined** | ${totals.all.files} | ${totals.all.lines} | ${totals.all.covered} | ${totals.all.lines - totals.all.covered} | **${totals.all.pct}%** |`);
  md.push('');
  const nodeRows = new Set(rows.filter((r) => r.kind === 'node').map((r) => r.file));
  const jsIn = b.jsFiles.filter((f) => nodeRows.has(f));
  const jsOut = b.jsFiles.filter((f) => !nodeRows.has(f));
  md.push(`Browser attribution: ${b.stats.flushes} page flushes, ${b.stats.entries} script records → ${b.stats.js} external-script hits on ${b.jsFiles.length} files, ${b.stats.inline} inline-block hits, ${b.stats.unattributed} unattributed (${b.unattributed.length} distinct — listed at the end). External-script hits merged into the \`node+browser\` rows: ${jsIn.join(', ') || 'none'}.${jsOut.length ? ` Hits on files outside the c8 include scope (not rows here): ${jsOut.join(', ')}.` : ''}`);
  md.push('');
  md.push('## Ranking');
  md.push('');
  md.push('`score = uncovered lines × weight`. Weight is **2** for a file on the credits / auth / dispatch / preflight / SSRF path (the `LOAD_BEARING` list in `scripts/coverage/report.js`), **1** otherwise. A page row counts only the lines inside its inline `<script>` blocks; a Node row counts every line of the file (c8 counts blank and comment lines the way V8 reports them).');
  md.push('');
  md.push('## All files, ranked by score');
  md.push('');
  md.push('| # | file | kind | lines | covered | uncovered | uncovered % | w | score |');
  md.push('|---:|---|---|---:|---:|---:|---:|---:|---:|');
  const noScript = ranked.filter((r) => r.total === 0);
  ranked.filter((r) => r.total > 0).forEach((r, i) => {
    md.push(`| ${i + 1} | \`${r.file}\` | ${r.kind}${r.browserToo ? '+browser' : ''} | ${r.total} | ${r.covered} | ${r.uncovered} | ${r.pctUncovered}% | ${r.weight} | ${r.score} |`);
  });
  md.push('');
  if (noScript.length) {
    md.push(`${noScript.length} tracked root pages carry no inline \`<script>\` block and have nothing to measure here (their behaviour lives in the shared root scripts above): ${noScript.map((r) => '`' + r.file + '`').join(', ')}.`);
    md.push('');
  }
  md.push(`## The ${WORST} worst — uncovered line ranges`);
  md.push('');
  md.push('One row per contiguous uncovered run of 3+ lines, in file order (capped at 45 per file; runs of 1–2 lines are summarised beneath). The note names the innermost enclosing function from V8\'s own function ranges; when the run is only part of that function, the first line of code in the run is quoted so the branch can be found without re-deriving it. Line numbers are 1-based and refer to the file at the commit above.');
  md.push('');
  const worst = ranked.slice(0, WORST);
  for (let i = 0; i < worst.length; i++) {
    const r = worst[i];
    const abs = path.join(ROOT, r.file);
    const src = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    let lineCounts, fns;
    if (r.kind === 'page') {
      lineCounts = b.pages[r.file].lines;
      fns = b.pages[r.file].fns;
    } else {
      const fc = final[abs];
      lineCounts = {};
      for (const id of Object.keys(fc.statementMap)) lineCounts[fc.statementMap[id].start.line] = fc.s[id];
      fns = Object.values(fc.fnMap).map((f) => ({ name: f.name, start: f.loc.start.line, end: f.loc.end.line }));
    }
    const d = describeRanges(r.file, lineCounts, fns, src);
    md.push(`### ${i + 1}. \`${r.file}\` — ${r.uncovered} uncovered of ${r.total} (${r.pctUncovered}%), weight ${r.weight}, score ${r.score}`);
    md.push('');
    if (r.kind === 'page') md.push(`Inline blocks: ${r.executedBlocks} of ${r.blocks} executed by at least one test.`, '');
    if (r.kind === 'node' && r.browserToo) md.push('Also loaded in the browser by page tests; counts are the union of both runtimes.', '');
    md.push('| lines | note |');
    md.push('|---|---|');
    for (const g of d.ranges) md.push(`| L${g.start}${g.end !== g.start ? '–' + g.end : ''} | ${g.note.replace(/\|/g, '\\|')} |`);
    if (d.omitted) md.push(`| … | ${d.omitted} more runs of 3+ lines not listed — see \`coverage/lcov.info\` |`);
    if (d.short.length) {
      const list = d.short.slice(0, 40).map((g) => `L${g.start}${g.end !== g.start ? '–' + g.end : ''}`).join(', ');
      md.push(`| short runs | ${d.short.length} runs of 1–2 lines: ${list}${d.short.length > 40 ? ', …' : ''} |`);
    }
    md.push('');
  }
  md.push('## Browser records that could not be attributed to a repo file');
  md.push('');
  if (!b.unattributed.length) md.push('None.');
  else {
    md.push('Scripts a page executed whose source matches no tracked `.js` file and no inline block of a tracked `.html` page — third-party bundles, test-served fixtures, generated pages. Listed so the gap is visible, never guessed at.');
    md.push('');
    md.push('| url | chars | flushes | why |');
    md.push('|---|---:|---:|---|');
    for (const u of b.unattributed.slice(0, 60)) md.push(`| \`${u.url.replace(/\|/g, '\\|').replace(ROOT, '…')}\` | ${u.length} | ${u.flushes} | ${u.note || ''} |`);
    if (b.unattributed.length > 60) md.push(`| … | ${b.unattributed.length - 60} more | | |`);
  }
  md.push('');
  fs.writeFileSync(path.join(COV, 'UNTESTED.md'), md.join('\n'));

  // 7. Console table, sorted by uncovered lines descending.
  if (print) {
    const byUncovered = [...rows].sort((x, y) => y.uncovered - x.uncovered || x.file.localeCompare(y.file));
    console.log('\nPer-file line coverage, sorted by uncovered lines (descending):\n');
    console.log(fmtTable(byUncovered, [
      { h: 'file', v: (r) => r.file },
      { h: 'kind', v: (r) => r.kind + (r.browserToo ? '+browser' : '') },
      { h: 'lines', v: (r) => r.total, right: true },
      { h: 'covered', v: (r) => r.covered, right: true },
      { h: 'uncovered', v: (r) => r.uncovered, right: true },
      { h: 'uncov %', v: (r) => r.pctUncovered + '%', right: true },
      { h: 'w', v: (r) => r.weight, right: true },
    ]));
    console.log('');
    console.log(`Node-side: ${totals.node.covered}/${totals.node.lines} lines (${totals.node.pct}%) across ${totals.node.files} files`);
    console.log(`Pages:     ${totals.page.covered}/${totals.page.lines} inline-script lines (${totals.page.pct}%) across ${totals.page.files} pages`);
    console.log(`Combined:  ${totals.all.covered}/${totals.all.lines} lines (${totals.all.pct}%)`);
    console.log(`Browser records: ${b.stats.entries} (${b.stats.js} external .js, ${b.stats.inline} inline, ${b.stats.unattributed} unattributed)`);
    console.log('\nWrote coverage/UNTESTED.md, coverage/lcov.info, coverage/summary-combined.json');
  }
  return combined;
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message || err); process.exit(1); });
}

module.exports = { main, LOAD_BEARING, weightOf };
