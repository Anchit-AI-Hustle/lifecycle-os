#!/usr/bin/env node
'use strict';
/**
 * scripts/coverage/run.js — run the Playwright suite with every line measured.
 * ---------------------------------------------------------------------------
 * `npm run coverage [-- <extra playwright args>]`
 *
 * Two runtimes, two instruments, one report:
 *
 *   NODE.  NODE_V8_COVERAGE=coverage/tmp is exactly what `c8` sets before
 *          spawning a command; setting it here instead of wrapping the run in
 *          `npx c8` lets the browser records be merged into the same directory
 *          BEFORE `c8 report` reads it. Playwright forks its workers with
 *          process.env, so every worker — where the specs `require()` the
 *          api/_shared modules in-process — writes its own coverage file.
 *
 *   BROWSER. NODE_OPTIONS=--require scripts/coverage/preload.js patches
 *          playwright-core in each worker so every page runs under
 *          `page.coverage.startJSCoverage()`; records land in coverage/browser.
 *
 * Then scripts/coverage/report.js attributes, merges (c8) and writes the map.
 *
 * PROJECTS. Defaults to the two Chromium projects (desktop-1280 runs every
 * spec; pixel-5 runs the responsive spec at phone width). page.coverage is
 * Chromium-only, and the WebKit projects (iphone-se, iphone-12, ipad) need a
 * WebKit build that not every environment has. Override with
 * COVERAGE_PROJECTS=a,b or by passing --project flags after `--`.
 *
 * The process exits with Playwright's exit code, so a failing suite still
 * fails the command — but the report is written first either way.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const COV = path.join(ROOT, 'coverage');
const TMP = path.join(COV, 'tmp');
const BROWSER = path.join(COV, 'browser');

for (const d of [TMP, BROWSER, path.join(COV, 'lcov-report')]) fs.rmSync(d, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(BROWSER, { recursive: true });

const userArgs = process.argv.slice(2);
const has = (flag) => userArgs.some((a) => a === flag || a.startsWith(flag + '='));
const projects = has('--project') ? [] : (process.env.COVERAGE_PROJECTS || 'desktop-1280,pixel-5').split(',').map((p) => '--project=' + p.trim());
const reporter = has('--reporter') ? [] : ['--reporter=line'];
const cli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const args = ['test', ...projects, ...reporter, ...userArgs];

const preload = path.join(__dirname, 'preload.js');
const env = {
  ...process.env,
  NODE_V8_COVERAGE: TMP,
  LIFECYCLE_COVERAGE_BROWSER_DIR: BROWSER,
  NODE_OPTIONS: [process.env.NODE_OPTIONS || '', `--require "${preload}"`].join(' ').trim(),
};

console.log(`[coverage] playwright ${args.join(' ')}`);
const t0 = Date.now();
const r = cp.spawnSync(process.execPath, [cli, ...args], { cwd: ROOT, stdio: 'inherit', env });
const durationMs = Date.now() - t0;
const commit = (() => { try { return cp.execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch { return ''; } })();
fs.writeFileSync(path.join(COV, 'run.json'), JSON.stringify({
  date: new Date().toISOString(), commit, args: ['playwright', ...args], exitCode: r.status, durationMs,
}, null, 2));
console.log(`[coverage] suite finished in ${Math.round(durationMs / 1000)}s with exit ${r.status}; ${fs.readdirSync(TMP).length} V8 files, ${fs.existsSync(path.join(BROWSER, 'entries')) ? fs.readdirSync(path.join(BROWSER, 'entries')).length : 0} browser flushes`);

require('./report').main()
  .then(() => process.exit(r.status == null ? 1 : r.status))
  .catch((err) => { console.error(err.stack || err); process.exit(1); });
