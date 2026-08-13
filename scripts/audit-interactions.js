#!/usr/bin/env node
'use strict';
/**
 * scripts/audit-interactions.js — does every control on every page actually DO something?
 *
 *   node scripts/audit-interactions.js            full report + per-page rating
 *   node scripts/audit-interactions.js --fail     exit 1 on any DEAD finding (CI gate)
 *   node scripts/audit-interactions.js --page=x   audit one file
 *   node scripts/audit-interactions.js --json     machine-readable (feeds the ratings table)
 *
 * WHY THIS EXISTS. audit-pages.js checks that every WORD of a page is right.
 * Nothing checked that every CONTROL is right. These pages are 60+ standalone
 * HTML files with inline JS, edited for months by hand and by generators; the
 * failure mode is silent and specific:
 *
 *   - a filter chip calls filterRows() that was renamed to applyFilter()
 *   - a CTA is a bare <button> nobody ever bound a listener to
 *   - getElementById('exp-body') survives after the id was changed to 'exp-list'
 *   - animation: slideUp .4s references a @keyframes that lives on another page
 *
 * None of these throw at load. The page renders, the button clicks, and nothing
 * happens. That is invisible to a smoke test and to a screenshot.
 *
 * HOW IT DECIDES. The analyser is deliberately conservative - a false "dead"
 * finding trains people to ignore the report, so evidence of wiring is accepted
 * from any of several sources, and anything genuinely ambiguous is reported as
 * UNPROVEN rather than DEAD:
 *
 *   handler   onclick="f()"        -> f must resolve in this page's symbol table
 *                                     (own script blocks + every local <script src>)
 *   dom ref   getElementById('x')  -> id="x" must appear SOMEWHERE in the file,
 *                                     including inside a JS template literal, so
 *                                     dynamically-built DOM counts as real
 *   control   button / chip / CTA  -> needs an inline handler, or an id/class/data
 *                                     attribute that JS actually references, or a
 *                                     real href, or a delegated document listener
 *   anim      animation: name      -> @keyframes name must be defined in the file
 *                                     or in a stylesheet the page links
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);
const FAIL_MODE = ARGS.includes('--fail');
const AS_JSON = ARGS.includes('--json');
const ONE = (ARGS.find((a) => a.startsWith('--page=')) || '').split('=')[1];

// ── Browser and platform globals a handler may legitimately call ────────────
const GLOBALS = new Set([
  'alert', 'confirm', 'prompt', 'console', 'window', 'document', 'event', 'this',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch', 'JSON',
  'Object', 'Array', 'String', 'Number', 'Math', 'Date', 'Boolean', 'RegExp',
  'localStorage', 'sessionStorage', 'navigator', 'location', 'history', 'screen',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'Promise', 'Set', 'Map',
  'WeakMap', 'WeakSet', 'Symbol', 'Proxy', 'Reflect', 'BigInt', 'Intl', 'Error',
  'requestAnimationFrame', 'cancelAnimationFrame', 'structuredClone', 'queueMicrotask',
  'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData', 'Headers',
  'Request', 'Response', 'AbortController', 'CustomEvent', 'Event', 'MouseEvent',
  'IntersectionObserver', 'MutationObserver', 'ResizeObserver', 'getComputedStyle',
  'scrollTo', 'scrollBy', 'open', 'close', 'print', 'btoa', 'atob', 'crypto',
  'performance', 'matchMedia', 'eval', 'Function', 'Image', 'Audio', 'Option',
  'DOMParser', 'XMLHttpRequest', 'WebSocket', 'Worker', 'Notification', 'top',
  'parent', 'self', 'globalThis', 'return', 'if', 'else', 'for', 'while', 'switch',
  'typeof', 'instanceof', 'new', 'delete', 'void', 'in', 'of', 'do', 'try', 'catch',
  // Keywords, not callables. An inline handler written as an IIFE -
  // oninput="(function(el){…})(this)" - otherwise reads as a call to a function
  // named "function".
  'function', 'async', 'await', 'yield', 'class', 'super',
]);

// ── Helpers ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function scriptBlocks(html) {
  let out = '';
  for (const m of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) out += m[1] + '\n';
  return out;
}

/**
 * Comments out of JS, markup left alone.
 *
 * Controls are scanned across the whole file, not just the static markup,
 * because a great deal of this product's UI is built inside template literals.
 * That means a prose mention of a tag in a code comment ("keep the hidden
 * <select> in sync") would otherwise be counted as a real control and reported
 * as unwired forever.
 */
function stripJsComments(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ');   // not a :// in a URL
}

function withoutJsComments(html) {
  return html.replace(
    /(<script\b(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/gi,
    (_, open, body, close) => open + stripJsComments(body) + close,
  );
}

function styleBlocks(html) {
  let out = '';
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) out += m[1] + '\n';
  for (const m of html.matchAll(/style="([^"]*)"/gi)) out += m[1] + '\n';
  return out;
}

/** Local files this page pulls in, so cross-file symbols resolve. */
function linkedScripts(html) {
  const files = [];
  for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/gi)) {
    const src = m[1].split('?')[0];
    if (/^https?:|^\/\//i.test(src)) continue;            // CDN: not ours to resolve
    const abs = path.join(ROOT, src.replace(/^\//, ''));
    if (fs.existsSync(abs)) files.push(abs);
  }
  return files;
}

function linkedStyles(html) {
  const files = [];
  for (const m of html.matchAll(/<link[^>]*\bhref="([^"]+\.css)"/gi)) {
    const href = m[1].split('?')[0];
    if (/^https?:|^\/\//i.test(href)) continue;
    const abs = path.join(ROOT, href.replace(/^\//, ''));
    if (fs.existsSync(abs)) files.push(abs);
  }
  return files;
}

/** Every name this JS defines at any scope, plus anything hung off window. */
function symbolsOf(js) {
  const s = new Set();
  for (const m of js.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
  for (const m of js.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
  for (const m of js.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
  for (const m of js.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) s.add(m[1]);
  for (const m of js.matchAll(/\bwindow\.__([\w$]*)/g)) s.add('__' + m[1]);
  // Destructured bindings: const { a, b } = ... / const [x, y] = ...
  for (const m of js.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]{1,200})[}\]]\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim().replace(/^\.\.\./, '').split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) s.add(name);
    }
  }
  // Function parameters (a handler may be defined inside a closure that takes them)
  for (const m of js.matchAll(/\bfunction\s*[A-Za-z_$\w]*\s*\(([^)]{0,300})\)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^\.\.\./, '').split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) s.add(name);
    }
  }
  return s;
}

/** Root identifiers invoked inside an inline handler attribute. */
function calledIdentifiers(code) {
  const out = new Set();
  // strip string literals so a name inside quotes is not read as a call
  const bare = code.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, '``');
  // Only ROOT identifiers matter. `this.closest(x).classList.remove(y)` is one
  // call chain rooted at `this`; without the lookbehind the analyser would read
  // `classList` and `remove` as free functions and report them missing.
  for (const m of bare.matchAll(/(?<![.\w$)\]])([A-Za-z_$][\w$]*)\s*(?:\.\s*[A-Za-z_$][\w$]*\s*)*\(/g)) {
    out.add(m[1]);
  }
  return out;
}

// ── The audit ───────────────────────────────────────────────────────────────
function pages() {
  if (ONE) return [ONE];
  return fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
}

const report = [];

for (const file of pages()) {
  const abs = path.join(ROOT, file);
  let html;
  try { html = fs.readFileSync(abs, 'utf8'); } catch (_) { continue; }

  const scanHtml = withoutJsComments(html);
  const ownJs = stripJsComments(scriptBlocks(html));
  let allJs = ownJs;
  for (const f of linkedScripts(html)) {
    try { allJs += '\n' + fs.readFileSync(f, 'utf8'); } catch (_) {}
  }

  let css = styleBlocks(html);
  for (const f of linkedStyles(html)) {
    try { css += '\n' + fs.readFileSync(f, 'utf8'); } catch (_) {}
  }

  const symbols = symbolsOf(allJs);
  const findings = [];
  const counts = {
    handlers: 0, handlersDead: 0,
    domRefs: 0, domRefsDead: 0, domRefsUnproven: 0,
    controls: 0, controlsUnproven: 0,
    anims: 0, animsDead: 0,
  };

  // ── 1. Inline handlers resolve to a real function ────────────────────────
  const HANDLER_ATTR = /\bon(click|change|input|submit|keyup|keydown|keypress|focus|blur|mouseenter|mouseleave|mouseover|mouseout|dblclick|toggle)\s*=\s*"([^"]*)"/gi;
  for (const m of scanHtml.matchAll(HANDLER_ATTR)) {
    counts.handlers++;
    const code = m[2];
    for (const id of calledIdentifiers(code)) {
      if (GLOBALS.has(id) || symbols.has(id)) continue;
      counts.handlersDead++;
      findings.push({
        severity: 'DEAD', rule: 'handler',
        detail: `on${m[1]}="${code.slice(0, 60)}" calls ${id}() which is not defined on this page`,
        line: scanHtml.slice(0, m.index).split('\n').length,
      });
      break;                                            // one finding per handler
    }
  }

  // ── 2. getElementById targets exist somewhere (static OR JS-built) ───────
  // Scanned against the page's OWN script blocks only. A lookup that lives in
  // shared auth.js is one fact about auth.js; attributing it to each of the 60
  // pages that include auth.js would bury the page-specific findings under
  // sixty identical lines and train everyone to skim past the report.
  for (const m of ownJs.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)) {
    counts.domRefs++;
    const id = m[1];
    const idRx = new RegExp(`id\\s*=\\s*['"\`]?${esc(id)}\\b`, 'i');
    // The id may be produced by a template literal (id="${g.id}-${i}"); a
    // dynamic segment near the literal counts as construction, not absence.
    const dynamic = new RegExp(`id\\s*=\\s*['"\`][^'"\`]*\\$\\{`).test(allJs);
    if (idRx.test(scanHtml) || idRx.test(allJs)) continue;
    if (dynamic && /-\d+$|-\$/.test(id)) continue;

    // A missing element is only a CRASH when the result is dereferenced on the
    // spot. Code that looks an element up and then guards it - the standard way
    // to clean up a legacy node, or to touch an element only some pages have -
    // is correct as written, so it is reported as UNPROVEN, not DEAD.
    const deref = new RegExp(`getElementById\\(\\s*['"]${esc(id)}['"]\\s*\\)\\s*\\.`).test(ownJs);
    if (deref) counts.domRefsDead++; else counts.domRefsUnproven++;
    findings.push({
      severity: deref ? 'DEAD' : 'UNPROVEN', rule: 'dom-ref',
      detail: deref
        ? `getElementById('${id}').… is dereferenced immediately, but no element with that id is ever created - this throws`
        : `getElementById('${id}') finds nothing on this page (result is guarded, so it degrades rather than throws)`,
      line: 0,
    });
  }

  // ── 3. Controls have SOME route to behaviour ─────────────────────────────
  // Delegated listeners on document/body make any descendant potentially live.
  // Scoped to the page's OWN script: auth.js carries document-level listeners
  // for the shared nav, and counting those would hand every page on the site a
  // blanket excuse for every unbound button it has.
  const DELEGATED = /(?:document|document\.body|window)\.addEventListener\(\s*['"](?:click|change|input)['"]/.test(ownJs);

  // Element-scoped delegation: a listener mounted on a wrapper that then reads
  // e.target. Any control inside such a wrapper is live even though nothing
  // names the control itself.
  const CONTAINER_DELEGATED =
    /(?:getElementById|querySelector)\([^)]*\)\s*\.addEventListener\(\s*['"](?:click|change|input)['"]/.test(ownJs) &&
    /\be\.target\b|\bevent\.target\b|\bcurrentTarget\b/.test(ownJs);

  const CONTROL_TAG = /<(button|select)\b([^>]*)>/gi;
  for (const m of scanHtml.matchAll(CONTROL_TAG)) {
    counts.controls++;
    const attrs = m[2] || '';
    if (/\bon(click|change|input|submit)\s*=/i.test(attrs)) continue;         // inline handler
    if (/\btype\s*=\s*"submit"/i.test(attrs)) continue;                       // form submit
    if (/\bdisabled\b/i.test(attrs)) continue;                                // deliberately inert

    const idM = attrs.match(/\bid\s*=\s*"([^"]+)"/i);
    if (idM && new RegExp(esc(idM[1])).test(allJs)) continue;                 // JS references the id

    const classes = (attrs.match(/\bclass\s*=\s*"([^"]*)"/i) || [, ''])[1].split(/\s+/).filter(Boolean);
    if (classes.some((c) => new RegExp(`['"\`.\\[]${esc(c)}\\b`).test(allJs))) continue;

    // A data attribute is read from JS under its camelCase dataset name as
    // often as its literal form: data-week is almost always dataset.week, never
    // the string "data-week". Checking only the literal reports every
    // delegated filter chip in the product as unwired.
    const dataM = [...attrs.matchAll(/\b(data-[\w-]+)\s*=/gi)].map((d) => d[1]);
    const dataNames = dataM.flatMap((d) => {
      const bare = d.replace(/^data-/, '');
      const camel = bare.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      return [d, `dataset.${camel}`, `dataset['${bare}']`];
    });
    if (dataNames.some((d) => new RegExp(esc(d)).test(allJs))) continue;

    // Delegation is usually mounted on the control's own container
    // (#week-filters.addEventListener('click', …)), not on document.
    if (CONTAINER_DELEGATED) continue;
    if (DELEGATED) continue;                            // a document-level listener may own it

    counts.controlsUnproven++;
    findings.push({
      severity: 'UNPROVEN', rule: 'control',
      detail: `<${m[1]}> with no handler, no referenced id/class/data attribute and no delegated listener`,
      line: html.slice(0, m.index).split('\n').length,
    });
  }

  // ── 4. Animations reference keyframes that exist ─────────────────────────
  const keyframes = new Set();
  for (const m of css.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)/g)) keyframes.add(m[1]);
  // JS may inject keyframes as a string; count those too.
  for (const m of allJs.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)/g)) keyframes.add(m[1]);

  // In the `animation` shorthand the name is the one component that is a bare
  // custom identifier: everything else is a duration (.8s, 2s, 300ms), a count,
  // a timing function, or one of a fixed set of keywords.
  const ANIM_KEYWORD = /^(?:infinite|linear|ease|ease-in|ease-out|ease-in-out|alternate|alternate-reverse|reverse|forwards|backwards|both|none|running|paused|normal|initial|inherit|unset|revert|steps|cubic-bezier|var|calc)$/i;
  for (const m of css.matchAll(/animation(?:-name)?\s*:\s*([^;}"']+)/gi)) {
    const parts = m[1].trim().split(/\s+/);
    for (const p of parts) {
      const name = p.replace(/[,;]/g, '').trim();
      if (!/^[A-Za-z_-][\w-]*$/.test(name)) continue;      // durations, counts, functions
      if (ANIM_KEYWORD.test(name) || /[()]/.test(name)) continue;
      counts.anims++;
      if (keyframes.has(name)) continue;
      counts.animsDead++;
      findings.push({
        severity: 'DEAD', rule: 'animation',
        detail: `animation "${name}" has no @keyframes definition reachable from this page`,
        line: 0,
      });
      break;
    }
  }

  // ── Rating ───────────────────────────────────────────────────────────────
  // Scored on what fraction of each interactive surface is provably wired.
  const ratio = (ok, total) => (total === 0 ? 1 : ok / total);
  const parts = [
    { w: 0.40, v: ratio(counts.handlers - counts.handlersDead, counts.handlers) },
    // A guarded miss degrades rather than throws, so it costs half of a crash.
    { w: 0.25, v: ratio(counts.domRefs - counts.domRefsDead - 0.5 * counts.domRefsUnproven, counts.domRefs) },
    { w: 0.25, v: ratio(counts.controls - counts.controlsUnproven, counts.controls) },
    { w: 0.10, v: ratio(counts.anims - counts.animsDead, counts.anims) },
  ];
  const score = Math.round(parts.reduce((a, p) => a + p.w * p.v, 0) * 100) / 10;

  report.push({ file, counts, findings, score });
}

// ── Output ──────────────────────────────────────────────────────────────────
if (AS_JSON) {
  console.log(JSON.stringify({ generated_by: 'scripts/audit-interactions.js', pages: report }, null, 2));
  process.exit(0);
}

const dead = report.reduce((a, p) => a + p.findings.filter((f) => f.severity === 'DEAD').length, 0);
const unproven = report.reduce((a, p) => a + p.findings.filter((f) => f.severity === 'UNPROVEN').length, 0);

for (const p of report) {
  if (!p.findings.length) continue;
  console.log(`\n${p.file}   rating ${p.score.toFixed(1)}/10`);
  for (const f of p.findings.slice(0, 12)) {
    console.log(`  ${f.severity.padEnd(9)} ${f.rule.padEnd(10)} ${f.detail}`);
  }
  if (p.findings.length > 12) console.log(`  ... and ${p.findings.length - 12} more`);
}

console.log(`\n${'─'.repeat(78)}`);
console.log('RATING BY PAGE (interactive wiring)\n');
const sorted = [...report].sort((a, b) => a.score - b.score);
for (const p of sorted) {
  const c = p.counts;
  const bar = '█'.repeat(Math.round(p.score)) + '░'.repeat(10 - Math.round(p.score));
  console.log(
    `  ${p.score.toFixed(1).padStart(4)}/10  ${bar}  ${p.file.padEnd(44)}` +
    `handlers ${String(c.handlers - c.handlersDead)}/${c.handlers}  ` +
    `refs ${String(c.domRefs - c.domRefsDead - c.domRefsUnproven)}/${c.domRefs}  ` +
    `controls ${String(c.controls - c.controlsUnproven)}/${c.controls}  ` +
    `anim ${String(c.anims - c.animsDead)}/${c.anims}`,
  );
}

const totals = report.reduce((a, p) => {
  for (const k of Object.keys(p.counts)) a[k] = (a[k] || 0) + p.counts[k];
  return a;
}, {});
const overall = report.length ? report.reduce((a, p) => a + p.score, 0) / report.length : 10;

console.log(`\n${'─'.repeat(78)}`);
console.log(`Pages: ${report.length}   overall interactive rating: ${overall.toFixed(2)}/10`);
console.log(`Inline handlers: ${totals.handlers}  (${totals.handlersDead} dead)`);
console.log(`DOM references:  ${totals.domRefs}  (${totals.domRefsDead} dead, ${totals.domRefsUnproven} guarded misses)`);
console.log(`Controls:        ${totals.controls}  (${totals.controlsUnproven} unproven)`);
console.log(`Animations:      ${totals.anims}  (${totals.animsDead} dead)`);
console.log(`\nDEAD: ${dead}   UNPROVEN: ${unproven}`);

if (FAIL_MODE && dead) {
  console.error(`\nFAIL: ${dead} control(s) on shipped pages call code that does not exist.`);
  process.exit(1);
}
