#!/usr/bin/env node
'use strict';
/**
 * Which Playwright specs a PULL REQUEST runs (2026-10-13).
 *
 * CI took over an hour because every PR ran all 173 spec files on one runner.
 * A PR now runs the specs its diff can reach; main runs everything (ci.yml),
 * so a miss here is caught on main by the "Main is red" issue, never shipped
 * silently. Rules, in order:
 *   1. not a pull request                            -> ALL
 *   2. a file every spec depends on changed          -> ALL (FULL_TRIGGERS)
 *   3. otherwise: the changed specs themselves, plus every spec whose text
 *      names a changed file (by path or basename), following `require` two
 *      levels up through api/, lib/, scripts/ and root .js files, so a change
 *      to a shared module reaches the specs of the routers that load it.
 *   Nothing selected -> NONE (the build job's checks still run).
 *
 * CLI: node scripts/ci-select-specs.js <base-ref>   prints ALL, NONE or a list.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const FULL_TRIGGERS = [
  /^package(-lock)?\.json$/, /^playwright\.config\.js$/, /^tests\/playwright\.config\.js$/,
  /^tests\/lib\//, /^tests\/[^/]*harness[^/]*\.js$/, /^\.github\/workflows\/ci\.yml$/, /^scripts\/ci-select-specs\.js$/,
  /^auth\.js$/, /^theme\.css$/, /^brand-context\.js$/, /^vercel\.json$/,
];

const base = (f) => path.basename(f);
const stem = (f) => base(f).replace(/\.(js|html|css|json|sql)$/, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does `text` name file `f` (its repo path, or its basename as a whole word, or a require of its stem)? */
function names(text, f) {
  if (text.includes(f)) return true;
  const b = base(f);
  if (new RegExp('(^|[^A-Za-z0-9_-])' + esc(b) + '([^A-Za-z0-9_-]|$)').test(text)) return true;
  if (/\.js$/.test(f)) return new RegExp('[/\'"]' + esc(stem(f)) + '[\'"]').test(text);
  return false;
}

/**
 * changed: repo paths in the diff. specs: { path: text } of tests/*.spec.js.
 * sources: { path: text } of the code that can load a module (api, lib, scripts, root .js).
 */
function selectSpecs({ event, changed, specs, sources }) {
  if (event !== 'pull_request') return { mode: 'ALL', reason: 'not a pull request' };
  const list = (changed || []).filter(Boolean);
  const trigger = list.find((f) => FULL_TRIGGERS.some((re) => re.test(f)));
  if (trigger) return { mode: 'ALL', reason: `${trigger} is shared by every spec` };
  // Changed code, widened two levels through the modules that load it.
  let frontier = list.filter((f) => !/^tests\/.*\.spec\.js$/.test(f));
  const reach = new Set(frontier);
  for (let level = 0; level < 2; level++) {
    const next = [];
    for (const [p, text] of Object.entries(sources || {})) {
      if (reach.has(p)) continue;
      if (frontier.some((f) => /\.js$/.test(f) && names(text, f))) { reach.add(p); next.push(p); }
    }
    frontier = next;
  }
  const picked = new Set(list.filter((f) => /^tests\/.*\.spec\.js$/.test(f) && specs[f] !== undefined));
  for (const [sp, text] of Object.entries(specs || {})) {
    if ([...reach].some((f) => names(text, f))) picked.add(sp);
  }
  if (!picked.size) return { mode: 'NONE', reason: 'no spec reaches the files this change touches' };
  return { mode: 'LIST', specs: [...picked].sort(), reason: `${picked.size} spec(s) reach the ${list.length} changed file(s)` };
}

function readTree(root) {
  const ls = (args) => cp.execSync('git ls-files ' + args, { cwd: root }).toString().split('\n').filter(Boolean);
  const specs = {}; const sources = {};
  for (const f of ls("'tests/*.spec.js'")) specs[f] = fs.readFileSync(path.join(root, f), 'utf8');
  for (const f of ls("'api/**/*.js' 'lib/**/*.js' 'scripts/**/*.js' '*.js'")) sources[f] = fs.readFileSync(path.join(root, f), 'utf8');
  return { specs, sources };
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const baseRef = process.argv[2] || 'origin/main';
  const event = process.env.GITHUB_EVENT_NAME || 'pull_request';
  let changed = [];
  try { changed = cp.execSync(`git diff --name-only ${baseRef}...HEAD`, { cwd: root }).toString().split('\n').filter(Boolean); }
  catch (e) { console.error('could not diff against ' + baseRef + ': ' + e.message + ' - running everything'); console.log('ALL'); process.exit(0); }
  const out = selectSpecs(Object.assign({ event, changed }, readTree(root)));
  console.error(out.mode + ': ' + out.reason);
  console.log(out.mode === 'LIST' ? out.specs.join('\n') : out.mode);
}

module.exports = { selectSpecs, names, FULL_TRIGGERS };
