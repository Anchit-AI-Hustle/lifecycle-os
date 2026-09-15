'use strict';
/**
 * scripts/coverage/browser.js — attribute browser JS coverage back to repo files.
 * ---------------------------------------------------------------------------
 * Input: the `{ url, sha1, length, functions }` rows and the content-addressed
 * sources that scripts/coverage/preload.js wrote under coverage/browser/.
 *
 * Output, two kinds, because c8 can only report one of them honestly:
 *
 *   1. EXTERNAL .js FILES the pages load (auth.js, brand-context.js, credits.js,
 *      chart-enhance.js, ...) are re-emitted as V8 process coverage into
 *      coverage/tmp/browser-*.json with a file:// URL. c8 then merges them with
 *      the Node-side hits of the same file (a line executed in either runtime is
 *      covered), through the same @bcoe/v8-coverage merge it uses for workers.
 *
 *   2. INLINE <script> BLOCKS inside .html pages are converted here, block by
 *      block, to per-line counts and shifted to the HTML file's line numbers.
 *      They cannot go through c8: v8-to-istanbul starts every line of a file at
 *      count 1 and only zeroes what V8's ranges say was not run, so feeding it
 *      an .html file would report every line of MARKUP and CSS as covered.
 *      Only the script lines are reported, so a page's "lines" figure is the
 *      number of lines inside its inline <script> blocks.
 *
 * ATTRIBUTION IS BY CONTENT, NOT BY URL. The specs serve the repo over
 * http://127.0.0.1:<port>/ or route fake origins (https://acme.example/...), so
 * a script's URL rarely names a file. The sha1 of its source is matched against
 * every tracked .js file and every inline block of every tracked .html file.
 * The URL path only breaks ties (the same snippet on several pages) and serves
 * as a last-resort fallback when the length matches. Anything else is listed in
 * `unattributed` with its URL and size — never silently dropped, never guessed.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');
const { mergeScriptCovs } = require('@bcoe/v8-coverage');
const v8toIstanbul = require('v8-to-istanbul');

const ROOT = path.resolve(__dirname, '..', '..');
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

const JS_TYPES = /^(text\/javascript|application\/javascript|text\/ecmascript|application\/ecmascript|module|text\/jsx)$/i;

/**
 * Inline <script> blocks of an HTML document, in document order.
 * A block with src= is an external script (attributed by its own hash); a block
 * whose type is not JavaScript (JSON, ld+json, templates) never reaches V8.
 */
function inlineBlocks(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (type && !JS_TYPES.test(type)) continue;
    const text = m[2];
    const bodyStart = m.index + '<script'.length + attrs.length + 1;
    if (html.slice(bodyStart, bodyStart + text.length) !== text) continue; // defensive: never mis-locate a block
    const startLine = 1 + (html.slice(0, bodyStart).match(/\n/g) || []).length;
    out.push({ text, startLine, lineCount: text.split('\n').length });
  }
  return out;
}

function trackedFiles() {
  const out = cp.execFileSync('git', ['ls-files', '-z', '--', '*.js', '*.html'], { cwd: ROOT, maxBuffer: 64 << 20 }).toString();
  return out.split('\0').filter(Boolean);
}

/** Every tracked .js file and every inline block of every tracked .html page, by content hash. */
function buildIndex() {
  const byHash = new Map();
  const js = new Map();     // rel → { length }
  const pages = new Map();  // rel → { blocks, lineCount }
  const add = (h, v) => { if (!byHash.has(h)) byHash.set(h, []); byHash.get(h).push(v); };
  for (const rel of trackedFiles()) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const content = stripBom(fs.readFileSync(abs, 'utf8'));
    if (rel.endsWith('.js')) {
      add(sha1(content), { kind: 'js', rel });
      js.set(rel, { length: content.length });
    } else {
      const blocks = inlineBlocks(content);
      pages.set(rel, { blocks, lineCount: content.split('\n').length, content });
      blocks.forEach((b, i) => add(sha1(b.text), { kind: 'inline', rel, block: i }));
    }
  }
  return { byHash, js, pages };
}

/**
 * Why a record matched nothing, so the ledger explains itself:
 *   - a third-party bundle, or a stub a test routed onto a CDN URL;
 *   - a tracked .js served with DIFFERENT content (a test route stubbing it);
 *   - an inline handler ATTRIBUTE (onerror="this.style.display='none'") — V8
 *     compiles those as their own one-line scripts under the page URL, so a
 *     short single-line miss on a page is that, not a lost <script> block;
 *   - a page served under a tracked name whose block text is not in the tree
 *     (a fixture page a spec writes itself).
 */
function classifyMiss(entry, index, src) {
  const pathname = urlPath(entry.url);
  if (/^https?:\/\/(?!127\.0\.0\.1|localhost)/.test(entry.url)) return 'third-party bundle, or a stub a test routed onto that origin';
  if (index.js.has(pathname)) return `tracked \`${pathname}\` served with different content (${entry.length} vs ${index.js.get(pathname).length} chars) — stubbed or rewritten by a test route`;
  if (index.pages.has(pathname) && src != null && entry.length < 400 && !/\n/.test(src)) return 'inline handler attribute (on*="…") on the page — not a <script> block';
  if (index.pages.has(pathname)) return `block text not found in tracked \`${pathname}\` — a fixture page served under that name, or a block a test rewrote`;
  return 'no tracked file with this content' + (pathname && !index.pages.has(pathname) && /\.html$/.test(pathname) ? ` (\`${pathname}\` is not a tracked page — a fixture a spec serves itself)` : '');
}

/**
 * Repo-relative path named by a script URL. http(s): the pathname. file: and
 * bare absolute paths (Playwright's `addScriptTag({ path })` names the script
 * by its filesystem path): relative to ROOT when inside it.
 */
function urlPath(u) {
  try {
    let p;
    if (/^file:/.test(u)) p = fileURLToPath(u);
    else if (/^\//.test(u)) p = u;
    else {
      p = decodeURIComponent(new URL(u).pathname).replace(/^\/+/, '');
      return p === '' ? 'index.html' : p;
    }
    const r = path.relative(ROOT, p);
    return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : p;
  } catch { return ''; }
}

/** `addScriptTag({ path })` appends `//# sourceURL=<path>`; the file itself is what ran. */
const SOURCE_URL_TRAILER = /\r?\n\/\/# sourceURL=[^\n]*\s*$/;

function attribute(entry, index, claims, sourceOf) {
  const pathname = urlPath(entry.url);
  const cands = index.byHash.get(entry.sha1) || [];
  if (cands.length) {
    const samePage = cands.filter((c) => c.rel === pathname);
    if (samePage.length > 1) {
      // Identical duplicate blocks on the SAME page: hand them out in order per flush.
      const key = entry.sha1 + '|' + pathname;
      const n = claims.get(key) || 0;
      claims.set(key, n + 1);
      return { ...samePage[Math.min(n, samePage.length - 1)], by: 'hash' };
    }
    return { ...(samePage[0] || cands[0]), by: 'hash' };
  }
  // No content match. Playwright's addScriptTag({ path }) appends a sourceURL
  // trailer to the file it injects; without it the text is the tracked file.
  const src = sourceOf(entry.sha1);
  const trailer = src && src.match(SOURCE_URL_TRAILER);
  if (trailer) {
    const bare = index.byHash.get(sha1(src.slice(0, trailer.index))) || [];
    const js = bare.find((c) => c.kind === 'js');
    if (js) return { ...js, by: 'sourceURL' };
  }
  // The URL path names a repo file of the same length: a served copy that
  // differs only in encoding (BOM/CRLF) - accepted and flagged.
  if (index.js.has(pathname) && index.js.get(pathname).length === entry.length) {
    return { kind: 'js', rel: pathname, by: 'url+length' };
  }
  // A page whose served HTML was rewritten by a test route: the block text may
  // still sit verbatim inside the tracked page - locate it, or give up. Never
  // for a one-line snippet: that is an inline handler ATTRIBUTE whose value
  // also sits verbatim in the markup, and the ledger rule says those are not
  // blocks - the same rule must hold here or the count moves by a few lines
  // depending on which page a test opened.
  if (index.pages.has(pathname) && src && (src.length >= 400 || /\n/.test(src))) {
    const page = index.pages.get(pathname);
    const at = src ? page.content.indexOf(src) : -1;
    if (at >= 0) {
      const startLine = 1 + (page.content.slice(0, at).match(/\n/g) || []).length;
      return { kind: 'inline', rel: pathname, block: -1, startLine, text: src, by: 'search' };
    }
  }
  return null;
}

async function blockCoverage(text, functions, virtualPath) {
  const conv = v8toIstanbul(virtualPath, 0, { source: text });
  await conv.load();
  conv.applyCoverage(functions);
  const fileCov = Object.values(conv.toIstanbul())[0];
  const lines = {};
  for (const id of Object.keys(fileCov.statementMap)) {
    lines[fileCov.statementMap[id].start.line] = fileCov.s[id];
  }
  const fns = Object.values(fileCov.fnMap).map((f) => ({
    name: f.name, start: f.loc.start.line, end: f.loc.end.line,
  }));
  return { lines, fns };
}

/**
 * Convert everything under browserDir. Writes coverage/tmp/browser-*.json for
 * external scripts and returns the inline-page map plus the honesty ledger.
 */
async function process_({ tmpDir, browserDir }) {
  const entriesDir = path.join(browserDir, 'entries');
  const sourcesDir = path.join(browserDir, 'sources');
  const index = buildIndex();
  const sourceOf = (h) => {
    const p = path.join(sourcesDir, h + '.txt');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };

  // A previous `coverage:report` may have written browser-*.json already.
  for (const f of fs.readdirSync(tmpDir)) if (/^browser-\d+\.json$/.test(f)) fs.unlinkSync(path.join(tmpDir, f));

  const jsCovs = new Map();      // rel → ScriptCov[]
  const inlineCovs = new Map();  // rel#block → { rel, block, startLine, text, covs: [] }
  const unattributed = new Map();// url|sha1 → { url, length, flushes }
  const stats = { entries: 0, flushes: 0, js: 0, inline: 0, unattributed: 0, byUrlLength: 0, bySearch: 0 };

  const files = fs.existsSync(entriesDir) ? fs.readdirSync(entriesDir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const f of files) {
    let rows;
    try { rows = JSON.parse(fs.readFileSync(path.join(entriesDir, f), 'utf8')); } catch { continue; }
    stats.flushes++;
    const claims = new Map();
    for (const e of rows) {
      stats.entries++;
      const hit = attribute(e, index, claims, sourceOf);
      if (!hit) {
        stats.unattributed++;
        const k = e.url + '|' + e.sha1;
        const u = unattributed.get(k) || { url: e.url, length: e.length, flushes: 0, note: classifyMiss(e, index, sourceOf(e.sha1)) };
        u.flushes++;
        unattributed.set(k, u);
        continue;
      }
      if (hit.by === 'url+length') stats.byUrlLength++;
      if (hit.by === 'search') stats.bySearch++;
      if (hit.by === 'sourceURL') stats.bySourceUrl = (stats.bySourceUrl || 0) + 1;
      if (hit.kind === 'js') {
        stats.js++;
        if (!jsCovs.has(hit.rel)) jsCovs.set(hit.rel, []);
        jsCovs.get(hit.rel).push({ scriptId: '0', url: pathToFileURL(path.join(ROOT, hit.rel)).href, functions: e.functions });
      } else {
        stats.inline++;
        const page = index.pages.get(hit.rel);
        const block = hit.block >= 0 ? page.blocks[hit.block] : { text: hit.text, startLine: hit.startLine };
        const key = hit.rel + '#' + (hit.block >= 0 ? hit.block : 's' + hit.startLine);
        if (!inlineCovs.has(key)) inlineCovs.set(key, { rel: hit.rel, block: hit.block, startLine: block.startLine, text: block.text, covs: [] });
        inlineCovs.get(key).covs.push({ scriptId: '0', url: 'inline://' + key, functions: e.functions });
      }
    }
  }

  // 1. External .js → V8 process coverage for c8, chunked so no file is huge.
  const jsFiles = [];
  let chunk = [], n = 0, bytes = 0;
  const flushChunk = () => {
    if (!chunk.length) return;
    fs.writeFileSync(path.join(tmpDir, `browser-${n++}.json`), JSON.stringify({ result: chunk }));
    chunk = []; bytes = 0;
  };
  for (const [rel, covs] of jsCovs) {
    const merged = mergeScriptCovs(covs);
    if (!merged) continue;
    merged.url = covs[0].url;
    jsFiles.push(rel);
    chunk.push(merged);
    bytes += JSON.stringify(merged).length;
    if (bytes > 20 * 1024 * 1024) flushChunk();
  }
  flushChunk();

  // 2. Inline blocks → per-line counts on HTML line numbers, every root page reported.
  const pages = {};
  const rootPages = [...index.pages.keys()].filter((rel) => !rel.includes('/'));
  const touched = new Set([...inlineCovs.values()].map((v) => v.rel));
  for (const rel of new Set([...rootPages, ...touched])) {
    const page = index.pages.get(rel);
    pages[rel] = { lines: {}, fns: [], blocks: page.blocks.length, executedBlocks: 0, total: 0, covered: 0 };
    // Every known block starts at 0 (not executed) …
    for (const b of page.blocks) {
      for (let i = 0; i < b.lineCount; i++) pages[rel].lines[b.startLine + i] = 0;
    }
  }
  for (const [, v] of inlineCovs) {
    const merged = mergeScriptCovs(v.covs);
    if (!merged) continue;
    const { lines, fns } = await blockCoverage(v.text, merged.functions, `/virtual/${v.rel}#${v.block}.js`);
    const page = pages[v.rel];
    page.executedBlocks++;
    for (const [l, c] of Object.entries(lines)) {
      const hl = v.startLine + Number(l) - 1;
      page.lines[hl] = Math.max(page.lines[hl] || 0, c);
    }
    for (const f of fns) page.fns.push({ name: f.name, start: v.startLine + f.start - 1, end: v.startLine + f.end - 1 });
  }
  for (const rel of Object.keys(pages)) {
    const p = pages[rel];
    const vals = Object.values(p.lines);
    p.total = vals.length;
    p.covered = vals.filter((c) => c > 0).length;
    p.fns.sort((a, b) => a.start - b.start || b.end - a.end);
  }

  const out = {
    stats,
    jsFiles: jsFiles.sort(),
    pages,
    unattributed: [...unattributed.values()].sort((a, b) => b.length - a.length),
  };
  fs.writeFileSync(path.join(browserDir, 'inline.json'), JSON.stringify(out));
  return out;
}

module.exports = { process: process_, inlineBlocks, buildIndex, attribute, urlPath, classifyMiss, ROOT };
