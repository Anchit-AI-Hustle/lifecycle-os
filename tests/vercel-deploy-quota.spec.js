// An agent branch does not spend the team's deploy budget.
//
// THE CASE THIS IS FOR. On 2026-09-29 Vercel refused to deploy two pushes to
// main (d9ac6a7 at 07:24 UTC, 61e34fc at 09:05 UTC): "Deployment rate limited -
// retry in 24 hours". The team is on Hobby, which allows 100 deployments per
// rolling day across EVERY project in the team. At 09:10 UTC there had been 95
// in the previous 24 hours; this project made 38 of them, and 21 of those were
// PREVIEWS of `claude/<something>` branches, each re-pushed many times (merges
// of main, fix-ups). A preview spends the same budget a production deploy of
// main needs, so once the cap is reached production is refused too - here and
// in every other project in the team. A rate-limited preview also posts a
// FAILED Vercel status on the PR head, and auto-merge.yml refuses any PR with a
// failed status, so the same cause blocked merges as well.
//
// THE FIX is Vercel's documented per-branch switch in vercel.json:
//
//   "git": { "deploymentEnabled": { "claude/**": false } }
//
// WHAT THIS SPEC DOES. It cannot ask Vercel which branches it will build, so it
// does the next best thing: it LOADS vercel.json and evaluates the rule with the
// real `minimatch` package (the syntax Vercel's docs name) under the semantics
// those docs state - keys are exact branch names or globs, a branch nobody
// matches deploys, and a branch several rules match deploys when AT LEAST ONE of
// them is true. The evaluator is itself checked against the docs' own examples
// first, so a wrong model of Vercel cannot make the config look right.
//
// This is a claim about what a config file DOES under its consumer's matcher,
// not a text search over it: `"claude/*"` would read as "the rule is there" to a
// text check and still let `claude/a/b` deploy. The last test (every other key
// is what main already deploys) IS a file property, and the right tool for it.
//
// Run: npx playwright test tests/vercel-deploy-quota.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { minimatch } = require('minimatch');

const ROOT = path.resolve(__dirname, '..');
const loadConfig = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

/**
 * Would a push to `branch` start a Git deployment, given vercel.json's `git`
 * block? Vercel's documented rules for `git.deploymentEnabled`:
 *   - absent            -> every branch deploys;
 *   - a boolean         -> applies to every branch;
 *   - an object         -> keys are branch names or minimatch globs; a branch no
 *                          key matches defaults to true; a branch several keys
 *                          match deploys when at least one matching rule is true.
 */
function deploysOnPush(gitBlock, branch) {
  const setting = gitBlock && gitBlock.deploymentEnabled;
  if (setting === undefined) return true;
  if (typeof setting === 'boolean') return setting;
  const matching = Object.entries(setting).filter(([pattern]) => pattern === branch || minimatch(branch, pattern));
  if (!matching.length) return true;
  return matching.some(([, enabled]) => enabled === true);
}

// Branch names taken from the measured 24 hours, plus a nested one: `claude/**`
// must cover a slash inside the name, which `claude/*` would not.
const AGENT_BRANCHES = [
  'claude/agents-working',
  'claude/mobile-pin-verified',
  'claude/review-fixes-routers-audit',
  'claude/signed-out-actions',
  'claude/platform-identity',
  'claude/execute-money-paths',
  'claude/vercel-quota',
  'claude/a/b',
];

// Production (`main`), the branch that syncs into it, the SiS distribution and
// an ordinary human branch all keep deploying. `claude-x` has no slash: the
// rule is about the agent namespace, not every name that starts with "claude".
const DEPLOYING_BRANCHES = ['main', 'final-product', 'snowflake-streamlit-app', 'feature-x', 'claude-x'];

test('the evaluator agrees with the examples in Vercel\'s own git-configuration docs', () => {
  // "Disable deployments for specific branches": { "dev": false }.
  expect(deploysOnPush({ deploymentEnabled: { dev: false } }, 'dev')).toBe(false);
  expect(deploysOnPush({ deploymentEnabled: { dev: false } }, 'main')).toBe(true);
  // "Match multiple branches using minimatch": { "internal-*": false }.
  expect(deploysOnPush({ deploymentEnabled: { 'internal-*': false } }, 'internal-tools')).toBe(false);
  expect(deploysOnPush({ deploymentEnabled: { 'internal-*': false } }, 'public-site')).toBe(true);
  // "Handle overlapping rules": at least one matching true rule deploys.
  const overlap = { deploymentEnabled: { 'experiment-*': false, '*-dev': true } };
  expect(deploysOnPush(overlap, 'experiment-dev')).toBe(true);
  expect(deploysOnPush(overlap, 'experiment-ui')).toBe(false);
  expect(deploysOnPush(overlap, 'feature-dev')).toBe(true);
  // "Disable all automatic Git deployments": false.
  expect(deploysOnPush({ deploymentEnabled: false }, 'main')).toBe(false);
  // No `git` block at all: everything deploys, which is what main had before.
  expect(deploysOnPush(undefined, 'claude/anything')).toBe(true);
});

test('no push to a claude/* branch starts a Vercel deployment', () => {
  const config = loadConfig();
  const rules = config.git && config.git.deploymentEnabled;
  expect(rules, 'vercel.json has no git.deploymentEnabled block').toBeTruthy();
  expect(typeof rules, 'the rule is per-branch, not a switch that turns off production as well').toBe('object');
  for (const [pattern, enabled] of Object.entries(rules)) {
    expect(typeof enabled, `rule "${pattern}" must be a boolean for Vercel to accept it`).toBe('boolean');
  }
  for (const branch of AGENT_BRANCHES) {
    expect(deploysOnPush(config.git, branch), `${branch} would still spend a deployment`).toBe(false);
  }
});

test('main, final-product, the SiS branch and a human branch still deploy', () => {
  const config = loadConfig();
  for (const branch of DEPLOYING_BRANCHES) {
    expect(deploysOnPush(config.git, branch), `${branch} would no longer deploy`).toBe(true);
  }
});

// ── the rule is the ONLY change ─────────────────────────────────────────────
// A file property: every other top-level key (rewrites, redirects, headers,
// functions, crons, buildCommand ...) is exactly what main already deploys.
// Compared against the merge-base with origin/main, so a main that moved on
// after this branch was cut is not read as this branch's change. Skipped when
// there is nothing to compare against: git missing, or a shallow CI checkout
// with no origin/main. And skipped once main itself carries the rule: from then
// on a change to a rewrite belongs to its own PR, and pinning every other key
// here would fail every one of them.

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
}

function mainsConfig() {
  let ref = 'origin/main';
  try { ref = git(['merge-base', 'HEAD', 'origin/main']).trim() || ref; } catch { /* keep origin/main */ }
  try { return { ref, config: JSON.parse(git(['show', `${ref}:vercel.json`])) }; } catch { return null; }
}

test('every other top-level key of vercel.json is unchanged from main', () => {
  const base = mainsConfig();
  test.skip(!base, 'git or origin/main is not available here, so there is no main version to compare against');
  const mainRules = base.config.git && base.config.git.deploymentEnabled;
  test.skip(mainRules !== undefined, `main (${base.ref.slice(0, 12)}) already carries git.deploymentEnabled; later edits to other keys are their own PRs' business`);

  const config = loadConfig();
  const others = (c) => Object.keys(c).filter((k) => k !== 'git').sort();
  expect(others(config)).toEqual(others(base.config));
  for (const key of others(base.config)) {
    expect(config[key], `vercel.json "${key}" differs from main (${base.ref.slice(0, 12)})`).toEqual(base.config[key]);
  }
});
