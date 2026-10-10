// Two GitHub Actions workflows are the code-side guarantees for two things
// measured in the week of 2026-09-15, both of which were "only fixable in
// dashboard settings" until now:
//
//   .github/workflows/auto-merge.yml       - a PR merges ONLY after the full CI
//                                            workflow on its head succeeded
//                                            (six were merged by hand 4-6 min
//                                            into a 14-min run; GitHub's own
//                                            auto-merge refuses without branch
//                                            protection, which main lacks).
//   .github/workflows/deploy-guarantee.yml - a green push to main reaches
//                                            Vercel production even when the
//                                            Git integration drops the push
//                                            (254e599 got no deployment).
//
// And a third, measured on 2026-10-04 (CLAUDE.md, "CI runs on main after an
// auto-merge"): a merge auto-merge.yml makes with GITHUB_TOKEN starts NO
// workflow run, so CI never ran on main for 13bf5f4, 7ac473b or dba59c8, and
// the combination several PRs left on main (and in production) was untested.
// auto-merge.yml now dispatches ci.yml on main, and ci.yml's `main-state` job
// keeps one "Main is red at <sha>" issue while main is red.
//
// Workflows cannot be executed here, so this spec does three different things
// and is explicit about which is which:
//
// 1. EVALUATED checks on the parsed YAML: which event STARTS which workflow and
//    whether each job's `if:` lets it run, computed by tests/lib/actions-model.js
//    (GitHub's expression language and trigger rules, written from GitHub's own
//    docs and first run over the docs' own examples below, so a wrong model
//    fails here before it can make a wrong workflow look right). A text check
//    on `if:` passes `== 'pull_request'` inside a `||` that defeats it; the
//    evaluation does not.
// 2. FILE-PROPERTY checks: which permissions the token carries, that no step
//    pulls a third-party action. Those are claims about the FILE, and a
//    parsed-file check is the right tool - the same judgement CLAUDE.md records
//    for "a migration must contain the revoke".
// 3. EXECUTED checks: each workflow's `run:` script is pulled out of the parsed
//    YAML and RUN under bash with a fake `gh` and a fake `curl` on PATH that
//    record every call and answer from a scenario. That is where the merge /
//    skip / refuse / report logic lives, and reading it would prove nothing - a
//    script that logged "refused" and merged anyway would pass a text check. The
//    scripts' inputs are the workflow's own `env:` block, so an env key added
//    to the YAML without a value here makes the script fail under `set -u`
//    rather than run with a hole. The fake `gh` also holds the token to the
//    job's OWN `permissions:` for every write (scopes from GitHub's endpoint
//    permission data), so a write the job is not allowed fails here as it
//    would there. Reads are not held to it: the repository is public, and the
//    merge job's own check-run and status reads have always worked with
//    `checks` and `statuses` unset (it could not have merged #141, #143 or
//    #144 otherwise).
// The chain test joins all three: the merge script's real API calls become the
// events GitHub would emit, and the model says which workflows and jobs follow.
//
// Run: npx playwright test tests/workflows-guarantees.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const model = require('./lib/actions-model');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const SIS = 'snowflake-streamlit-app';
const REPO = 'Anchit-AI-Hustle/lifecycle-os';
const HEAD = '6f17c2a36d79f004532e5e89af6b1b1785134cd3';      // a real PR head on main's history
const MERGE_SHA = '254e5999d513d2ba9bb913d74dd8846ce6ef06ef'; // the merge commit that made it
const THIS_RUN = '4242424242';

// ── YAML ────────────────────────────────────────────────────────────────────
// `yaml` (YAML 1.2, as GitHub reads workflows: `on` is a key, not a boolean)
// is a devDependency since 2026-10-04. PyYAML through python3 stays as the
// fallback for a checkout without node_modules; it is YAML 1.1, so the bare
// `on:` key parses as the boolean true - `triggersOf()` reads both spellings.

function parseYamlDocument(absPath) {
  for (const mod of ['yaml', 'js-yaml']) {
    try {
      const lib = require(mod);
      return (lib.parse || lib.load)(fs.readFileSync(absPath, 'utf8'));
    } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  const py = 'import json, sys, yaml\nprint(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8").read())))';
  let r = spawnSync('python3', ['-c', py, absPath], { encoding: 'utf8' });
  if (r.status !== 0 && /No module named .?yaml/.test(r.stderr || '')) {
    spawnSync('python3', ['-m', 'pip', 'install', '--user', '--quiet', 'pyyaml'], { encoding: 'utf8', timeout: 180000 });
    r = spawnSync('python3', ['-c', py, absPath], { encoding: 'utf8' });
  }
  if (r.status !== 0) throw new Error(`no YAML parser available (npm yaml/js-yaml, or python3 + PyYAML): ${r.stderr || r.error}`);
  return JSON.parse(r.stdout);
}

const parsed = {};
const workflow = (name) => (parsed[name] ||= parseYamlDocument(path.join(WORKFLOWS, name)));
const triggersOf = (wf) => wf.on || wf.true || wf.True;
const onlyJob = (wf) => {
  const names = Object.keys(wf.jobs || {});
  expect(names, 'exactly one job').toHaveLength(1);
  return { jobName: names[0], job: wf.jobs[names[0]] };
};
const onlyRunStep = (job) => {
  const steps = job.steps || [];
  expect(steps.filter((s) => s.uses), 'no third-party action').toEqual([]);
  expect(steps.filter((s) => typeof s.run === 'string'), 'exactly one run step').toHaveLength(1);
  return steps.find((s) => typeof s.run === 'string');
};

/** Every value under any `permissions:` key, anywhere in the document. */
function permissionValues(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'permissions') out.push(v);
    permissionValues(v, out);
  }
  return out;
}

/**
 * The script's environment, derived from the workflow's own `env:` block: a
 * literal value is passed as written, an expression (`${{ ... }}`) must be
 * supplied by the test. A key the test does not know about is left UNSET so
 * `set -u` in the script fails loudly instead of running with a hole.
 */
function envFromJob(job, supplied) {
  const env = { ...process.env };
  for (const [k, v] of Object.entries(job.env || {})) {
    const value = String(v);
    if (value.includes('${{')) {
      if (!(k in supplied)) { delete env[k]; continue; }
      env[k] = supplied[k];
    } else env[k] = value;
  }
  return env;
}

// ── FAKES ───────────────────────────────────────────────────────────────────
// `gh` records {key, fields} per call and answers from a scenario file keyed
// "<METHOD> <endpoint-without-query>". A value may be a plain JSON body, null
// (a 204), {http, message, body} (an error, exit 1 with gh's stderr shape), or
// {seq: [...]} answering successive calls in order.
//
// Every WRITE is first held to the job's own `permissions:` (FAKE_GH_PERMISSIONS)
// using WRITE_SCOPES: a write the job lacks the scope for is answered 403
// "Resource not accessible by integration" and logged `refused`, as GitHub
// would; a write with no entry in the table is a harness error (exit 2), so a
// new write call cannot slip past the check unmodelled.

// From github/docs src/github-apps/data/fpt-2022-11-28/server-to-server-permissions.json
// (2bd66de): the repository permission each endpoint needs, `*` = one path
// segment, `**` = the rest of the path. Either listed scope suffices.
const WRITE_SCOPES = [
  ['POST', 'repos/*/*/actions/workflows/*/dispatches', ['actions']],
  ['POST', 'repos/*/*/dispatches', ['contents']],
  ['PUT', 'repos/*/*/pulls/*/merge', ['contents']],
  ['DELETE', 'repos/*/*/git/refs/**', ['contents']],
  ['POST', 'repos/*/*/issues', ['issues']],
  ['PATCH', 'repos/*/*/issues/*', ['issues', 'pull-requests']],
  ['POST', 'repos/*/*/issues/*/comments', ['issues', 'pull-requests']],
];

const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] !== 'api') { process.stderr.write('fake gh: only "gh api" is modelled\\n'); process.exit(2); }
let method = 'GET', endpoint = null; const fields = [];
for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === '-X' || a === '--method') { method = args[++i]; continue; }
  if (a === '-f' || a === '-F' || a === '--raw-field' || a === '--field') { fields.push(args[++i]); continue; }
  if (a === '--jq' || a === '-q' || a === '-H' || a === '--header') { i++; continue; }
  if (a.startsWith('-')) continue;
  if (endpoint === null) endpoint = a;
}
const path = String(endpoint).replace(/\\?.*$/, '');
const key = method.toUpperCase() + ' ' + path;
const log = process.env.FAKE_GH_LOG;
const prior = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const nth = prior.filter((c) => c.key === key).length;
if (method.toUpperCase() !== 'GET') {
  const perms = JSON.parse(process.env.FAKE_GH_PERMISSIONS || '{}');
  const segs = path.split('/');
  const rule = JSON.parse(process.env.FAKE_GH_WRITE_SCOPES).find(([m, pat]) => {
    if (m !== method.toUpperCase()) return false;
    const ps = pat.split('/');
    if (ps[ps.length - 1] === '**') return segs.length >= ps.length && ps.slice(0, -1).every((p, i) => p === '*' || p === segs[i]);
    return ps.length === segs.length && ps.every((p, i) => p === '*' || p === segs[i]);
  });
  if (!rule) { process.stderr.write('fake gh: no permission rule for the write ' + key + '\\n'); process.exit(2); }
  if (!rule[2].some((s) => perms[s] === 'write')) {
    fs.appendFileSync(log, JSON.stringify({ key, fields, refused: 403 }) + '\\n');
    process.stdout.write(JSON.stringify({ message: 'Resource not accessible by integration' }));
    process.stderr.write('gh: Resource not accessible by integration (HTTP 403)\\n');
    process.exit(1);
  }
}
fs.appendFileSync(log, JSON.stringify({ key, fields }) + '\\n');
const scenario = JSON.parse(fs.readFileSync(process.env.FAKE_GH_SCENARIO, 'utf8'));
let answer = scenario[key];
if (answer === undefined) { process.stderr.write('fake gh: no scenario answer for ' + key + '\\n'); process.exit(1); }
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
if (isObj(answer) && Array.isArray(answer.seq)) answer = answer.seq[Math.min(nth, answer.seq.length - 1)];
if (isObj(answer) && answer.http) {
  process.stdout.write(JSON.stringify(answer.body || { message: answer.message }));
  process.stderr.write('gh: ' + answer.message + ' (HTTP ' + answer.http + ')\\n');
  process.exit(1);
}
if (answer !== null) process.stdout.write(JSON.stringify(answer));
`;

const FAKE_CURL = `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(process.env.FAKE_CURL_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
const exitCode = Number(process.env.FAKE_CURL_EXIT || 0);
if (exitCode) { process.stderr.write('curl: (22) The requested URL returned error: 404\\n'); process.exit(exitCode); }
process.stdout.write('{"job":{"id":"fake-job-id","state":"PENDING","createdAt":0}}');
`;

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-guarantees-'));
  fs.writeFileSync(path.join(dir, 'gh'), FAKE_GH, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'curl'), FAKE_CURL, { mode: 0o755 });
  return dir;
}

const readCalls = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// ── SCENARIOS for the merge script ──────────────────────────────────────────

const pullRequest = (n, over = {}) => ({
  number: n, state: 'open', merged: false, draft: false, title: `Change ${n}`,
  head: { sha: HEAD, ref: `claude/change-${n}`, repo: { full_name: REPO } },
  base: { ref: 'main' }, mergeable_state: 'clean',
  user: { login: 'anchittandon-create' }, author_association: 'MEMBER',
  ...over,
});

// Every check on the head commit is green, and this very run's own check is
// in progress (it always is) and must be ignored rather than waited for.
const greenChecks = () => ({ check_runs: [
  { name: 'build', status: 'completed', conclusion: 'success', details_url: 'https://github.com/x/actions/runs/1/job/1' },
  { name: 'Visual + invariant tests (Playwright)', status: 'completed', conclusion: 'success', details_url: 'https://github.com/x/actions/runs/1/job/2' },
  { name: 'block-sis-branch', status: 'completed', conclusion: 'success', details_url: 'https://github.com/x/actions/runs/2/job/3' },
  { name: 'Merge the PR whose head just went green', status: 'in_progress', conclusion: null, details_url: `https://github.com/x/actions/runs/${THIS_RUN}/job/9` },
] });

const scenarioFor = (pr, over = {}) => ({
  [`GET repos/${REPO}/commits/${HEAD}/pulls`]: [pr],
  [`GET repos/${REPO}/pulls`]: [pr],
  [`GET repos/${REPO}/pulls/${pr.number}`]: pr,
  [`GET repos/${REPO}/commits/${HEAD}/check-runs`]: greenChecks(),
  [`GET repos/${REPO}/commits/${HEAD}/status`]: { state: 'success', statuses: [] },
  [`PUT repos/${REPO}/pulls/${pr.number}/merge`]: { sha: MERGE_SHA, merged: true, message: 'Pull Request successfully merged' },
  [`DELETE repos/${REPO}/git/refs/heads/${pr.head.ref}`]: null,
  [`POST repos/${REPO}/dispatches`]: null,
  [`POST repos/${REPO}/actions/workflows/ci.yml/dispatches`]: null,   // 204, as GitHub answers
  ...over,
});

/** Run one job's single `run:` script under bash with the fakes, the job's own env and its own permissions. */
function runJobScript(wf, job, scenario, supplied) {
  const dir = sandbox();
  const scriptPath = path.join(dir, 'job.sh');
  fs.writeFileSync(scriptPath, onlyRunStep(job).run);
  const scenarioPath = path.join(dir, 'scenario.json');
  fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
  const logPath = path.join(dir, 'gh-calls.jsonl');
  const env = envFromJob(job, supplied);
  Object.assign(env, {
    PATH: dir + path.delimiter + process.env.PATH, FAKE_GH_LOG: logPath, FAKE_GH_SCENARIO: scenarioPath, POLL_SECONDS: '0',
    FAKE_GH_PERMISSIONS: JSON.stringify(job.permissions || wf.permissions || {}),
    FAKE_GH_WRITE_SCOPES: JSON.stringify(WRITE_SCOPES),
  });
  const r = spawnSync('bash', [scriptPath], { env, encoding: 'utf8', timeout: 60000 });
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || ''), calls: readCalls(logPath) };
}

function runMerge(scenario, eventOver = {}, { permissions } = {}) {
  const wf = workflow('auto-merge.yml');
  const { job } = onlyJob(wf);
  const r = runJobScript(wf, permissions ? { ...job, permissions } : job, scenario, {
    GH_TOKEN: 'ghs_fake', REPO, HEAD_SHA: HEAD, HEAD_BRANCH: 'claude/change-7', HEAD_REPO: REPO,
    CI_EVENT: 'pull_request',
    CI_RUN_ID: '777', CI_RUN_URL: 'https://github.com/x/actions/runs/777', THIS_RUN_ID: THIS_RUN,
    ...eventOver,
  });
  const { calls } = r;
  return {
    ...r,
    merges: calls.filter((c) => c.key.startsWith('PUT ') && c.key.endsWith('/merge')),
    dispatches: calls.filter((c) => c.key === `POST repos/${REPO}/dispatches`),
    ciDispatches: calls.filter((c) => /^POST repos\/[^/]+\/[^/]+\/actions\/workflows\/[^/]+\/dispatches$/.test(c.key)),
    deletes: calls.filter((c) => c.key.startsWith('DELETE ')),
  };
}

function runDeploy(supplied, { curlExit = 0 } = {}) {
  const dir = sandbox();
  const { job } = onlyJob(workflow('deploy-guarantee.yml'));
  const scriptPath = path.join(dir, 'deploy.sh');
  fs.writeFileSync(scriptPath, onlyRunStep(job).run);
  const logPath = path.join(dir, 'curl-calls.jsonl');
  const env = envFromJob(job, { TRIGGER: 'workflow_run', HEAD_SHA: MERGE_SHA, REASON: 'spec', ...supplied });
  Object.assign(env, { PATH: dir + path.delimiter + process.env.PATH, FAKE_CURL_LOG: logPath, FAKE_CURL_EXIT: String(curlExit) });
  const r = spawnSync('bash', [scriptPath], { env, encoding: 'utf8', timeout: 60000 });
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || ''), calls: readCalls(logPath) };
}

const isPosix = process.platform !== 'win32';

// ═══════════════════════════════════════════════════════════════════════════
// 0. THE MODEL, checked against GitHub's own documentation before it is used
//    (github/docs 2bd66de: expressions.md, events-that-trigger-workflows.md,
//    actions-do-not-trigger-workflows.md). Every expected value below is the
//    one the docs state for that example.
// ═══════════════════════════════════════════════════════════════════════════

test('the expression model reproduces the examples and rules in GitHub\'s expressions documentation', () => {
  const ev = (e, ctx) => model.evaluate(e, ctx);
  // Literals.
  expect(ev('null')).toBe(null);
  expect(ev('false')).toBe(false);
  expect(ev('711')).toBe(711);
  expect(ev('-9.2')).toBe(-9.2);
  expect(ev('0xff')).toBe(255);
  expect(ev('-2.99e-2')).toBe(-0.0299);
  expect(ev("'It''s open source!'")).toBe("It's open source!");
  expect(() => ev('"double"'), 'wrapping with double quotes throws').toThrow();
  // Functions, with the docs' inputs and results.
  const labels = { github: { event: { issue: { labels: [{ name: 'bug' }, { name: 'help wanted' }] } } } };
  expect(ev("contains('Hello world', 'llo')")).toBe(true);
  expect(ev("contains(github.event.issue.labels.*.name, 'bug')", labels)).toBe(true);
  expect(ev("contains(github.event.issue.labels.*.name, 'wontfix')", labels)).toBe(false);
  for (const [name, want] of [['push', true], ['pull_request', true], ['workflow_dispatch', false]]) {
    expect(ev("contains(fromJSON('[\"push\", \"pull_request\"]'), github.event_name)", { github: { event_name: name } }), name).toBe(want);
  }
  expect(ev("startsWith('Hello world', 'He')")).toBe(true);
  expect(ev("endsWith('Hello world', 'ld')")).toBe(true);
  expect(ev("format('Hello {0} {1} {2}', 'Mona', 'the', 'Octocat')")).toBe('Hello Mona the Octocat');
  expect(ev("format('{{Hello {0} {1} {2}!}}', 'Mona', 'the', 'Octocat')")).toBe('{Hello Mona the Octocat!}');
  expect(ev("join(github.event.issue.labels.*.name, ', ')", labels)).toBe('bug, help wanted');
  for (const [ref, want] of [['refs/heads/main', 'production'], ['refs/heads/staging', 'staging'], ['refs/heads/feature/x', 'development'], ['refs/tags/v1', 'unknown']]) {
    const g = { github: { ref } };
    expect(ev("case(github.ref == 'refs/heads/main', 'production', 'development')", g), ref).toBe(want === 'production' ? 'production' : 'development');
    expect(ev("case(github.ref == 'refs/heads/main', 'production', github.ref == 'refs/heads/staging', 'staging', startsWith(github.ref, 'refs/heads/feature/'), 'development', 'unknown')", g), ref).toBe(want);
  }
  // Object filters: an array of objects, and an object of objects.
  const fruits = [{ name: 'apple', quantity: 1 }, { name: 'orange', quantity: 2 }, { name: 'pear', quantity: 1 }];
  expect(ev('fruits.*.name', { fruits })).toEqual(['apple', 'orange', 'pear']);
  const vegetables = {
    scallions: { colors: ['green', 'white', 'red'], ediblePortions: ['roots', 'stalks'] },
    beets: { colors: ['purple', 'red', 'gold', 'white', 'pink'], ediblePortions: ['roots', 'stems', 'leaves'] },
    artichokes: { colors: ['green', 'purple', 'red', 'black'], ediblePortions: ['hearts', 'stems', 'leaves'] },
  };
  const sortJson = (a) => a.map((x) => JSON.stringify(x)).sort();
  expect(sortJson(ev('vegetables.*.ediblePortions', { vegetables })))   // "the order of the output cannot be guaranteed"
    .toEqual(sortJson([['roots', 'stalks'], ['hearts', 'stems', 'leaves'], ['roots', 'stems', 'leaves']]));
  // Loose equality, coercion to number, case, NaN, instances.
  expect(ev("'abc' == 'ABC'"), 'strings compare ignoring case').toBe(true);
  expect(ev('null == 0')).toBe(true);
  expect(ev('true == 1')).toBe(true);
  expect(ev("'' == 0"), 'the empty string is 0').toBe(true);
  expect(ev("'1.5' == 1.5"), 'a JSON number string').toBe(true);
  expect(ev("'0x10' == 16"), 'hex is not a JSON number').toBe(false);
  expect(ev("fromJSON('[]') == fromJSON('[]')"), 'arrays equal only as one instance').toBe(false);
  for (const op of ['<', '<=', '>', '>=']) expect(ev(`'abc' ${op} 0`), `NaN ${op}`).toBe(false);
  // Falsy: false, 0, -0, '', null. Everything else is truthy.
  for (const f of ['false', '0', '-0', "''", 'null']) expect(ev(`!${f}`), f).toBe(true);
  for (const t of ["'false'", "'0'", '1', 'true']) expect(ev(`!${t}`), t).toBe(false);
  // && and || return an operand, which is what makes the docs' ternary idiom work.
  expect(ev("github.ref == 'refs/heads/main' && 'value_for_main_branch' || 'value_for_other_branches'", { github: { ref: 'refs/heads/main' } })).toBe('value_for_main_branch');
  expect(ev("github.ref == 'refs/heads/main' && 'value_for_main_branch' || 'value_for_other_branches'", { github: { ref: 'refs/heads/x' } })).toBe('value_for_other_branches');
  // `if:` conditions, including the default success() and the ${{ }} form.
  expect(model.ifPasses("github.repository == 'octo-org/octo-repo-prod'", { github: { repository: 'octo-org/octo-repo-prod' } })).toBe(true);
  expect(model.ifPasses("github.repository == 'octo-org/octo-repo-prod'", { github: { repository: 'someone/else' } })).toBe(false);
  expect(model.ifPasses("${{ ! startsWith(github.ref, 'refs/tags/') }}", { github: { ref: 'refs/tags/v1' } })).toBe(false);
  expect(model.ifPasses("${{ ! startsWith(github.ref, 'refs/tags/') }}", { github: { ref: 'refs/heads/main' } })).toBe(true);
  const failedNeed = { cancelled: false, needs: { build: 'failure' } };
  expect(model.ifPasses("github.ref == 'refs/heads/main'", { github: { ref: 'refs/heads/main' } }, failedNeed), 'success() is applied by default').toBe(false);
  expect(model.ifPasses("${{ !cancelled() }}", {}, failedNeed), 'unless a status function is named').toBe(true);
  expect(model.ifPasses("${{ !cancelled() }}", {}, { cancelled: true, needs: { build: 'success' } })).toBe(false);
  expect(model.ifPasses("${{ always() }}", {}, { cancelled: true, needs: {} })).toBe(true);
  expect(model.ifPasses("${{ failure() && steps.demo.conclusion == 'failure' }}", { steps: { demo: { conclusion: 'failure' } } }, failedNeed)).toBe(true);
  expect(model.ifPasses("${{ github.event.workflow_run.conclusion == 'success' }}", workflowRunContextOf('success'))).toBe(true);
  expect(model.ifPasses("${{ github.event.workflow_run.conclusion == 'failure' }}", workflowRunContextOf('success'))).toBe(false);
  // The docs' concurrency example: a release branch does not cancel, main does.
  expect(model.interpolate("${{ !contains(github.ref, 'release/')}}", { github: { ref: 'refs/heads/release/1.2.3' } })).toBe(false);
  expect(model.interpolate("${{ !contains(github.ref, 'release/')}}", { github: { ref: 'refs/heads/main' } })).toBe(true);
  expect(model.interpolate('${{ github.workflow }}-${{ github.ref }}', { github: { workflow: 'CI', ref: 'refs/heads/main' } })).toBe('CI-refs/heads/main');
});

/** For the docs examples above, before the spec's own helper is declared. */
function workflowRunContextOf(conclusion) {
  return { github: { event_name: 'workflow_run', event: { workflow_run: { conclusion } } } };
}

test('the trigger model reproduces the documented rules: GITHUB_TOKEN starts only dispatches, and workflow_run / types / branch filters', () => {
  // actions-do-not-trigger-workflows.md: "if a workflow run pushes code using
  // the repository's GITHUB_TOKEN, a new workflow will not run even when the
  // repository contains a workflow configured to run when push events occur";
  // workflow_dispatch and repository_dispatch "always create workflow runs".
  const onPush = { on: { push: { branches: ['main'] } } };
  expect(model.startsRun(onPush, 'p.yml', { name: 'push', ref: 'refs/heads/main' })).toBe(true);
  expect(model.startsRun(onPush, 'p.yml', { name: 'push', ref: 'refs/heads/main', byGithubToken: true })).toBe(false);
  expect(model.startsRun({ on: 'workflow_dispatch' }, 'd.yml', { name: 'workflow_dispatch', workflowFile: 'd.yml', ref: 'refs/heads/main', byGithubToken: true })).toBe(true);
  expect(model.startsRun({ on: { repository_dispatch: { types: ['test_result'] } } }, 'r.yml', { name: 'repository_dispatch', type: 'test_result', byGithubToken: true })).toBe(true);
  expect(model.startsRun({ on: { repository_dispatch: { types: ['test_result'] } } }, 'r.yml', { name: 'repository_dispatch', type: 'other' })).toBe(false);
  // A dispatch names one workflow file, and the API refuses an input the workflow does not declare.
  expect(model.startsRun({ on: 'workflow_dispatch' }, 'd.yml', { name: 'workflow_dispatch', workflowFile: 'other.yml', ref: 'refs/heads/main' })).toBe(false);
  expect(model.startsRun({ on: { workflow_dispatch: {} } }, 'd.yml', { name: 'workflow_dispatch', workflowFile: 'd.yml', ref: 'refs/heads/main', inputs: { logLevel: 'warning' } })).toBe(false);
  // workflow_run: "workflows: [Build], types: [requested], branches: [canary]".
  const canary = { on: { workflow_run: { workflows: ['Build'], types: ['requested'], branches: ['canary'] } } };
  expect(model.startsRun(canary, 'w.yml', { name: 'workflow_run', workflow: 'Build', action: 'requested', headBranch: 'canary' })).toBe(true);
  expect(model.startsRun(canary, 'w.yml', { name: 'workflow_run', workflow: 'Build', action: 'requested', headBranch: 'main' })).toBe(false);
  expect(model.startsRun(canary, 'w.yml', { name: 'workflow_run', workflow: 'Build', action: 'completed', headBranch: 'canary' })).toBe(false);
  expect(model.startsRun(canary, 'w.yml', { name: 'workflow_run', workflow: 'Lab', action: 'requested', headBranch: 'canary' })).toBe(false);
  // "workflows: [Staging, Lab]": only one of them needs to run.
  const either = { on: { workflow_run: { workflows: ['Staging', 'Lab'], types: ['completed'] } } };
  expect(model.startsRun(either, 'w.yml', { name: 'workflow_run', workflow: 'Lab', action: 'completed', headBranch: 'x' })).toBe(true);
  // A filter the model does not understand is an error, not an "it starts".
  expect(() => model.startsRun({ on: { push: { paths: ['src/**'] } } }, 'p.yml', { name: 'push', ref: 'refs/heads/main' })).toThrow(/not modelled/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. EVALUATED + FILE PROPERTIES - auto-merge.yml
// ═══════════════════════════════════════════════════════════════════════════

test('auto-merge fires on the CI workflow COMPLETING, and CI itself runs on pull_request so that event exists', () => {
  const wf = workflow('auto-merge.yml');
  const on = triggersOf(wf);
  // workflow_run and nothing else: a pull_request(_target) trigger would run
  // beside CI instead of after it, and pull_request_target hands a write token
  // to fork code.
  expect(Object.keys(on)).toEqual(['workflow_run']);
  expect(on.workflow_run.workflows).toEqual(['CI']);
  expect(on.workflow_run.types).toEqual(['completed']);
  expect(on.workflow_run['branches-ignore']).toContain(SIS);

  // The first link of the chain: the workflow named "CI" must exist under that
  // exact name and run on pull_request (every PR, no branch filter, so
  // Dependabot's and claude/* alike) and on push to main. Renaming CI would
  // silently disarm BOTH guarantees, so the name is pinned here.
  const ci = workflow('ci.yml');
  expect(ci.name).toBe('CI');
  const ciOn = triggersOf(ci);
  expect(ciOn).toHaveProperty('pull_request');
  expect(ciOn.pull_request === null || typeof ciOn.pull_request === 'object').toBe(true);
  expect(ciOn.push.branches).toContain('main');
});

/** The contexts a workflow_run-triggered job evaluates its `if:` against. */
const workflowRunContext = ({ conclusion = 'success', event = 'pull_request', headBranch = 'claude/change-7' } = {}) => ({
  github: { event_name: 'workflow_run', event: { workflow_run: { conclusion, event, head_branch: headBranch } } },
});

/** Every event a run of ci.yml can be raised by, read off ci.yml itself, plus one it has never had. */
const ciEvents = () => [...Object.keys(model.triggersOf(workflow('ci.yml'))), 'schedule'];

test('the merge job runs ONLY for a CI run that SUCCEEDED and that a PULL_REQUEST raised - evaluated, for every event CI can be raised by', () => {
  const { job } = onlyJob(workflow('auto-merge.yml'));
  expect(job['runs-on']).toBe('ubuntu-latest');
  const events = ciEvents();
  // The run auto-merge itself dispatches after a merge is one of them.
  expect(events).toContain('workflow_dispatch');
  for (const event of events) {
    for (const conclusion of ['success', 'failure', 'cancelled', 'timed_out', 'skipped']) {
      for (const headBranch of ['claude/change-7', 'main']) {
        const runs = model.ifPasses(job.if, workflowRunContext({ conclusion, event, headBranch }));
        expect(runs, `${event} / ${conclusion} / ${headBranch}`).toBe(event === 'pull_request' && conclusion === 'success');
      }
    }
  }
});

test('the head-ref guard against the SiS branch lives in the JOB, not only in protect-main-from-sis.yml', () => {
  const { job } = onlyJob(workflow('auto-merge.yml'));
  // Evaluated: a green pull_request run whose head is the SiS branch does not run the job.
  expect(model.ifPasses(job.if, workflowRunContext({ headBranch: SIS }))).toBe(false);
  expect(model.ifPasses(job.if, workflowRunContext({ headBranch: SIS.toUpperCase() })), 'GitHub compares strings ignoring case').toBe(false);
  // And the trigger itself never starts for a CI run on it.
  expect(model.startsRun(workflow('auto-merge.yml'), 'auto-merge.yml', { name: 'workflow_run', workflow: 'CI', action: 'completed', headBranch: SIS })).toBe(false);
  expect(job.env.FORBIDDEN_HEAD).toBe(SIS);
  const run = onlyRunStep(job).run;
  // The event's head branch AND the PR's own head ref are both compared to it.
  expect(run).toContain('"$HEAD_BRANCH" = "$FORBIDDEN_HEAD"');
  expect(run).toContain('"$PR_HEAD_REF" = "$FORBIDDEN_HEAD"');
  // The never-delete list keeps the distribution branch and the production
  // sources even if a PR from one of them were ever merged by hand.
  for (const b of ['main', 'final-product', SIS]) expect(job.env.NEVER_DELETE.split(/\s+/)).toContain(b);

  // The required check this complements is untouched: it still fails any PR
  // whose head is the SiS branch, with no token at all.
  const guard = workflow('protect-main-from-sis.yml');
  expect(triggersOf(guard).pull_request.branches).toContain('main');
  expect(guard.permissions).toEqual({});
  const blockStep = guard.jobs['block-sis-branch'].steps.find((s) => String(s.if || '').includes(`github.head_ref == '${SIS}'`));
  expect(blockStep).toBeTruthy();
  expect(blockStep.run).toContain('exit 1');
});

test('permissions are least-privilege in all three files: the merge job adds exactly actions:write for the CI dispatch, deploy has none, main-state reads actions and writes issues', () => {
  const am = workflow('auto-merge.yml');
  const dg = workflow('deploy-guarantee.yml');
  const ci = workflow('ci.yml');
  expect(am.permissions).toEqual({});
  expect(dg.permissions).toEqual({});
  // merge (contents + pull-requests), the repository_dispatch (contents), and
  // the workflow dispatch of ci.yml on main (actions) - and nothing else.
  expect(onlyJob(am).job.permissions).toEqual({ 'pull-requests': 'write', contents: 'write', actions: 'write' });
  expect(onlyJob(dg).job.permissions).toBeUndefined();
  // CI's top-level token still only reads the checkout, and the build and
  // test jobs do not raise it. Only main-state does, and only by what it does.
  expect(ci.permissions).toEqual({ contents: 'read' });
  for (const [id, job] of Object.entries(ci.jobs)) if (id !== 'main-state') expect(job.permissions, id).toBeUndefined();
  expect(ci.jobs['main-state'].permissions).toEqual({ actions: 'read', issues: 'write' });
  for (const wf of [am, dg, ci]) {
    for (const p of permissionValues(wf)) {
      // `permissions: write-all` is a STRING shorthand; anything else must be a
      // map of scope -> read|write|none.
      if (typeof p === 'string') expect(p, 'no write-all / read-all shorthand').not.toMatch(/write-all|read-all/);
      else for (const v of Object.values(p || {})) expect(['read', 'write', 'none']).toContain(v);
    }
    // Event-controlled values reach the scripts through env, never by
    // interpolating an expression into shell: a branch name is
    // attacker-chosen on a public repository.
    for (const j of Object.values(wf.jobs)) for (const s of j.steps) if (s.run) expect(s.run).not.toContain('${{');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. EXECUTED - the merge script against a fake gh
// ═══════════════════════════════════════════════════════════════════════════

test('a green PR by a collaborator is merged with a MERGE COMMIT pinned to the green head, its branch deleted, and the deploy guarantee dispatched', () => {
  test.skip(!isPosix, 'executes bash');
  const pr = pullRequest(7);
  const r = runMerge(scenarioFor(pr));
  expect(r.rc, r.out).toBe(0);
  expect(r.merges).toHaveLength(1);
  expect(r.merges[0].key).toBe(`PUT repos/${REPO}/pulls/7/merge`);
  expect(r.merges[0].fields).toContain('merge_method=merge');     // what every merge on main already is
  expect(r.merges[0].fields).toContain(`sha=${HEAD}`);            // GitHub refuses if the head moved meanwhile
  expect(r.out).toContain(`MERGED PR #7 into main as ${MERGE_SHA}`);
  expect(r.out).toContain('CI run 777 succeeded');
  // The head branch goes; the never-delete list is respected elsewhere.
  expect(r.deletes.map((c) => c.key)).toEqual([`DELETE repos/${REPO}/git/refs/heads/claude/change-7`]);
  // Because a GITHUB_TOKEN merge starts no push workflow, the deploy guarantee
  // is fired directly, with the merge commit, under the event type the other
  // workflow listens for.
  expect(r.dispatches).toHaveLength(1);
  const eventType = triggersOf(workflow('deploy-guarantee.yml')).repository_dispatch.types[0];
  expect(r.dispatches[0].fields).toContain(`event_type=${eventType}`);
  expect(r.dispatches[0].fields).toContain(`client_payload[sha]=${MERGE_SHA}`);
  expect(r.dispatches[0].fields).toContain('client_payload[pr]=7');
  // And because that same merge starts no CI on main, CI is dispatched on main
  // exactly once, for the workflow file whose `name:` is CI, with `ref` alone
  // (ci.yml declares no inputs; the API refuses one it does not declare), and
  // only after the merge it is there to test.
  expect(r.ciDispatches).toHaveLength(1);
  expect(r.ciDispatches[0].refused).toBeUndefined();
  const file = /actions\/workflows\/([^/]+)\/dispatches$/.exec(r.ciDispatches[0].key)[1];
  expect(workflow(file).name).toBe('CI');
  expect(r.ciDispatches[0].fields).toEqual(['ref=main']);
  expect(r.calls.indexOf(r.ciDispatches[0])).toBeGreaterThan(r.calls.indexOf(r.merges[0]));
  expect(r.out).toContain('Dispatched CI (ci.yml) on main after 1 merge(s)');
  // Every read happened BEFORE the write.
  const firstPut = r.calls.findIndex((c) => c.key.startsWith('PUT '));
  const lastGet = r.calls.map((c) => c.key.startsWith('GET ')).lastIndexOf(true);
  expect(firstPut).toBeGreaterThan(-1);
  expect(lastGet).toBeLessThan(firstPut);
});

test('two PRs merged by one job: the deploy guarantee once PER MERGE, CI on main ONCE, after the last merge', () => {
  test.skip(!isPosix, 'executes bash');
  // Two branches can point at one commit; both PRs are green on it.
  const a = pullRequest(7);
  const b = pullRequest(8, { head: { sha: HEAD, ref: 'claude/change-8', repo: { full_name: REPO } } });
  const r = runMerge(scenarioFor(a, {
    [`GET repos/${REPO}/commits/${HEAD}/pulls`]: [a, b],
    [`GET repos/${REPO}/pulls/8`]: b,
    [`PUT repos/${REPO}/pulls/8/merge`]: { sha: 'b'.repeat(40), merged: true },
    [`DELETE repos/${REPO}/git/refs/heads/claude/change-8`]: null,
  }));
  expect(r.rc, r.out).toBe(0);
  expect(r.merges.map((c) => c.key)).toEqual([`PUT repos/${REPO}/pulls/7/merge`, `PUT repos/${REPO}/pulls/8/merge`]);
  expect(r.dispatches).toHaveLength(2);
  // CI tests main's HEAD, which holds both merges: one run, not one per merge.
  expect(r.ciDispatches).toHaveLength(1);
  const lastMerge = r.calls.indexOf(r.merges[r.merges.length - 1]);
  expect(r.calls.indexOf(r.ciDispatches[0])).toBeGreaterThan(lastMerge);
  expect(r.out).toContain('after 2 merge(s)');
});

test('a CI run that NO pull_request raised - the dispatch after a merge, a push to main, Run workflow - merges nothing, dispatches nothing, asks the API nothing', () => {
  test.skip(!isPosix, 'executes bash');
  // Adversarial on purpose: the API names an open, green, mergeable PR whose
  // head IS the commit that run tested. A run on main tested main, not that
  // PR's merge ref, so it must not vouch for it. Without the script's own
  // event check this scenario merges PR #50.
  const pr = pullRequest(50, { head: { sha: MERGE_SHA, ref: 'claude/same-commit', repo: { full_name: REPO } } });
  const scenario = {
    ...scenarioFor(pr),
    [`GET repos/${REPO}/commits/${MERGE_SHA}/pulls`]: [pr],
    [`GET repos/${REPO}/commits/${MERGE_SHA}/check-runs`]: greenChecks(),
    [`GET repos/${REPO}/commits/${MERGE_SHA}/status`]: { state: 'success', statuses: [] },
  };
  // The control: as a pull_request run, the same scenario DOES merge, so the
  // refusals below are the event check and nothing else.
  const control = runMerge(scenario, { HEAD_SHA: MERGE_SHA, HEAD_BRANCH: 'claude/same-commit' });
  expect(control.merges, control.out).toHaveLength(1);
  for (const event of ciEvents().filter((e) => e !== 'pull_request')) {
    const r = runMerge(scenario, { CI_EVENT: event, HEAD_SHA: MERGE_SHA, HEAD_BRANCH: 'main' });
    expect(r.rc, `${event}: ${r.out}`).toBe(0);
    expect(r.calls, event).toEqual([]);
    expect(r.merges, event).toEqual([]);
    expect(r.dispatches, event).toEqual([]);
    expect(r.ciDispatches, event).toEqual([]);
    expect(r.out, event).toContain(`raised by '${event}', not by a pull request`);
    expect(r.out, event).not.toContain('::error::');
  }
});

test('a CI dispatch GitHub refuses FAILS the job and says how to run CI by hand; without actions:write it is refused exactly as GitHub would', () => {
  test.skip(!isPosix, 'executes bash');
  const refused = runMerge(scenarioFor(pullRequest(40), {
    [`POST repos/${REPO}/actions/workflows/ci.yml/dispatches`]: { http: 422, message: "Workflow does not have 'workflow_dispatch' trigger" },
  }));
  expect(refused.merges).toHaveLength(1);           // the merge stands
  expect(refused.dispatches).toHaveLength(1);       // and so does the deploy guarantee
  expect(refused.rc).not.toBe(0);                   // but main is untested, and that is loud
  expect(refused.out).toMatch(/::error::Merged, but CI could not be dispatched on main \(.*HTTP 422.*\), so what is now on main is UNTESTED\. Run it by hand: Actions -> CI -> Run workflow -> main/);

  // The job's own permissions, minus the one scope this change added: the
  // fake answers the dispatch 403 as GitHub's permission table says it would.
  const { job } = onlyJob(workflow('auto-merge.yml'));
  const { actions, ...withoutActions } = job.permissions;
  expect(actions).toBe('write');
  const r = runMerge(scenarioFor(pullRequest(41)), {}, { permissions: withoutActions });
  expect(r.merges).toHaveLength(1);
  expect(r.ciDispatches).toHaveLength(1);
  expect(r.ciDispatches[0].refused).toBe(403);
  expect(r.rc).not.toBe(0);
  expect(r.out).toContain("no longer has 'actions: write'");
});

test('a Dependabot PR is merged on the same terms (its author association is not MEMBER)', () => {
  test.skip(!isPosix, 'executes bash');
  const pr = pullRequest(72, {
    title: 'Bump @capacitor/cli from 8.5.0 to 8.5.1',
    head: { sha: HEAD, ref: 'dependabot/npm_and_yarn/capacitor/cli-8.5.1', repo: { full_name: REPO } },
    user: { login: 'dependabot[bot]' }, author_association: 'CONTRIBUTOR',
  });
  const r = runMerge(scenarioFor(pr), { HEAD_BRANCH: pr.head.ref });
  expect(r.rc, r.out).toBe(0);
  expect(r.merges).toHaveLength(1);
  expect(r.deletes.map((c) => c.key)).toEqual([`DELETE repos/${REPO}/git/refs/heads/${pr.head.ref}`]);
  expect(r.out).toContain('MERGED PR #72');
});

test('a PR whose head is the SiS branch is REFUSED by the script, loudly, whatever the event said', () => {
  test.skip(!isPosix, 'executes bash');
  // The event names an innocent branch; the PR's own head ref is the
  // distribution branch. The script must trust the API's head ref.
  const pr = pullRequest(8, { head: { sha: HEAD, ref: SIS, repo: { full_name: REPO } } });
  const r = runMerge(scenarioFor(pr), { HEAD_BRANCH: 'looks-harmless' });
  expect(r.rc).not.toBe(0);
  expect(r.merges).toEqual([]);
  expect(r.dispatches).toEqual([]);
  expect(r.ciDispatches).toEqual([]);
  expect(r.out).toMatch(new RegExp(`::error::.*${SIS}.*must never merge into main`));

  // And when the event itself names it, nothing is even asked of the API.
  const r2 = runMerge(scenarioFor(pullRequest(8)), { HEAD_BRANCH: SIS });
  expect(r2.rc).not.toBe(0);
  expect(r2.calls).toEqual([]);
  expect(r2.out).toContain('::error::');
});

test('a PR that is already merged is a clean exit 0, with no merge attempted', () => {
  test.skip(!isPosix, 'executes bash');
  const pr = pullRequest(9, { merged: true, state: 'closed' });
  // The union of both lookups may still list it (the commit's associated PR).
  const r = runMerge(scenarioFor(pr, {
    [`GET repos/${REPO}/commits/${HEAD}/pulls`]: [{ ...pr, state: 'open' }],
    [`GET repos/${REPO}/pulls`]: [],
  }));
  expect(r.rc, r.out).toBe(0);
  expect(r.merges).toEqual([]);
  expect(r.out).toContain('PR #9 is already merged');
  expect(r.out).not.toContain('::error::');
});

test('the race - GitHub refuses the merge and a re-read shows someone else merged it - is exit 0, not a failure', () => {
  test.skip(!isPosix, 'executes bash');
  const pr = pullRequest(10);
  const r = runMerge(scenarioFor(pr, {
    [`PUT repos/${REPO}/pulls/10/merge`]: { http: 409, message: 'Head branch was modified. Review and try the merge again.' },
    [`GET repos/${REPO}/pulls/10`]: { seq: [pr, { ...pr, merged: true, state: 'closed' }] },
  }));
  expect(r.rc, r.out).toBe(0);
  expect(r.merges).toHaveLength(1);           // it tried, exactly once
  expect(r.dispatches).toEqual([]);           // and did not claim a merge it did not make
  expect(r.ciDispatches).toEqual([]);         // a person merged it; their push runs CI itself
  expect(r.out).toContain('merged by someone else');
  expect(r.out).not.toContain('::error::');
});

test('a FAILED check on the head - the SiS guard, CodeQL, a preview build - blocks the merge even though CI itself is green', () => {
  test.skip(!isPosix, 'executes bash');
  const checks = greenChecks();
  checks.check_runs[2] = { ...checks.check_runs[2], conclusion: 'failure' };   // block-sis-branch
  const r = runMerge(scenarioFor(pullRequest(11, { mergeable_state: 'unstable' }), {
    [`GET repos/${REPO}/commits/${HEAD}/check-runs`]: checks,
  }));
  expect(r.rc, r.out).toBe(0);
  expect(r.merges).toEqual([]);
  expect(r.out).toMatch(/SKIPPED PR #11: a check on .* did not pass - failed: block-sis-branch/);
});

test('a check still running after the wait leaves the PR to a human; a failed commit status blocks too', () => {
  test.skip(!isPosix, 'executes bash');
  const checks = greenChecks();
  checks.check_runs.push({ name: 'CodeQL', status: 'in_progress', conclusion: null, details_url: 'https://github.com/x/actions/runs/5/job/5' });
  const pending = runMerge(scenarioFor(pullRequest(12), { [`GET repos/${REPO}/commits/${HEAD}/check-runs`]: checks }));
  expect(pending.rc, pending.out).toBe(0);
  expect(pending.merges).toEqual([]);
  expect(pending.out).toMatch(/SKIPPED PR #12: checks still running after waiting - pending: CodeQL/);

  const status = runMerge(scenarioFor(pullRequest(13), {
    [`GET repos/${REPO}/commits/${HEAD}/status`]: { state: 'failure', statuses: [{ context: 'Vercel', state: 'failure' }] },
  }));
  expect(status.rc, status.out).toBe(0);
  expect(status.merges).toEqual([]);
  expect(status.out).toMatch(/SKIPPED PR #13: a commit status on .* failed - Vercel/);
});

test('every refusal that hands the PR to a human: fork, outsider, draft, conflict, other base, head moved', () => {
  test.skip(!isPosix, 'executes bash');
  const cases = [
    ['fork',       pullRequest(20, { head: { sha: HEAD, ref: 'claude/change-20', repo: { full_name: 'someone/lifecycle-os' } } }), /a fork/],
    ['outsider',   pullRequest(21, { user: { login: 'drive-by' }, author_association: 'NONE' }),                                  /not a collaborator or Dependabot/],
    ['draft',      pullRequest(22, { draft: true }),                                                                               /SKIPPED PR #22: draft/],
    ['conflict',   pullRequest(23, { mergeable_state: 'dirty' }),                                                                  /merge conflict/],
    ['other base', pullRequest(24, { base: { ref: 'final-product' } }),                                                            /base is 'final-product'/],
    ['head moved', pullRequest(25, { head: { sha: 'f'.repeat(40), ref: 'claude/change-25', repo: { full_name: REPO } } }),         /No open PR has/],
  ];
  for (const [label, pr, reason] of cases) {
    const r = runMerge(scenarioFor(pr));
    expect(r.rc, `${label}: ${r.out}`).toBe(0);
    expect(r.merges, label).toEqual([]);
    expect(r.dispatches, label).toEqual([]);
    expect(r.ciDispatches, label).toEqual([]);
    expect(r.out, label).toMatch(reason);
    expect(r.out, label).not.toContain('::error::');
  }
});

test('a merge that GitHub rejects for a reason we do not model FAILS the job rather than being swallowed', () => {
  test.skip(!isPosix, 'executes bash');
  const pr = pullRequest(30);
  const r = runMerge(scenarioFor(pr, {
    [`PUT repos/${REPO}/pulls/30/merge`]: { http: 403, message: 'Resource not accessible by integration' },
  }));
  expect(r.rc).not.toBe(0);
  expect(r.out).toMatch(/::error::PR #30: the token could not merge/);
  expect(r.out).toContain('DEPENDABOT');      // points at the header's explanation and remedy
  expect(r.dispatches).toEqual([]);
  expect(r.ciDispatches).toEqual([]);         // nothing merged, nothing new on main to test
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. FILE PROPERTIES - deploy-guarantee.yml
// ═══════════════════════════════════════════════════════════════════════════

test('deploy-guarantee chains on CI succeeding for a PUSH to main, can be fired by auto-merge or by hand, and deliberately ignores the CI run auto-merge dispatches', () => {
  const wf = workflow('deploy-guarantee.yml');
  const on = triggersOf(wf);
  expect(on.workflow_run.workflows).toEqual(['CI']);
  expect(on.workflow_run.types).toEqual(['completed']);
  expect(on.workflow_run.branches).toEqual(['main']);
  expect(on.repository_dispatch.types).toEqual(['deploy-guarantee']);
  expect(on).toHaveProperty('workflow_dispatch');
  const { job } = onlyJob(wf);
  // Evaluated over every event CI can be raised by: the hook fires for a
  // successful CI run raised by a PUSH on main and for nothing else - not a
  // fork PR whose branch is called main, and NOT the CI run auto-merge.yml
  // dispatches on main, because auto-merge already fired this workflow for
  // that merge and a second firing is a second production build.
  for (const event of ciEvents()) {
    for (const conclusion of ['success', 'failure', 'cancelled']) {
      for (const headBranch of ['main', 'claude/x']) {
        const fires = model.ifPasses(job.if, workflowRunContext({ conclusion, event, headBranch }));
        expect(fires, `${event} / ${conclusion} / ${headBranch}`).toBe(event === 'push' && conclusion === 'success' && headBranch === 'main');
      }
    }
  }
  // The dispatch paths are not re-gated: they carry their own reason.
  for (const name of ['repository_dispatch', 'workflow_dispatch']) {
    expect(model.ifPasses(job.if, { github: { event_name: name, event: { client_payload: { sha: MERGE_SHA } } } }), name).toBe(true);
  }
  expect(job.env.VERCEL_DEPLOY_HOOK_URL).toBe('${{ secrets.VERCEL_DEPLOY_HOOK_URL }}');
  onlyRunStep(job);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. EXECUTED - the deploy script against a fake curl
// ═══════════════════════════════════════════════════════════════════════════

test('without the secret the deploy job SKIPS (exit 0), names the secret and where to create the hook, and fires nothing', () => {
  test.skip(!isPosix, 'executes bash');
  const r = runDeploy({});                       // VERCEL_DEPLOY_HOOK_URL deliberately unset
  expect(r.rc, r.out).toBe(0);
  expect(r.calls).toEqual([]);                   // curl never ran
  expect(r.out).toContain('SKIPPED: VERCEL_DEPLOY_HOOK_URL is not set');
  expect(r.out).toMatch(/Settings -> Git -> Deploy Hooks/);
  expect(r.out).toMatch(/branch main/);
  expect(r.out).not.toContain('::error::');

  // An empty secret is the same state as an absent one.
  const empty = runDeploy({ VERCEL_DEPLOY_HOOK_URL: '' });
  expect(empty.rc).toBe(0);
  expect(empty.calls).toEqual([]);
});

test('with the secret the deploy job POSTs the hook exactly once and reports the job Vercel returned', () => {
  test.skip(!isPosix, 'executes bash');
  const hook = 'https://api.vercel.com/v1/integrations/deploy/prj_fake/hookfake';
  const r = runDeploy({ VERCEL_DEPLOY_HOOK_URL: hook });
  expect(r.rc, r.out).toBe(0);
  expect(r.calls).toHaveLength(1);
  const argv = r.calls[0];
  expect(argv[argv.indexOf('-X') + 1]).toBe('POST');
  expect(argv[argv.length - 1]).toBe(hook);
  expect(argv).toContain('-fsS');
  expect(r.out).toContain('Deploy hook accepted');
  expect(r.out).toContain('job fake-job-id state PENDING');
});

test('a secret that is set but refused by Vercel FAILS the job, so a stale hook is visible instead of silently useless', () => {
  test.skip(!isPosix, 'executes bash');
  const r = runDeploy({ VERCEL_DEPLOY_HOOK_URL: 'https://api.vercel.com/v1/integrations/deploy/prj_fake/rotated' }, { curlExit: 22 });
  expect(r.rc).not.toBe(0);
  expect(r.calls).toHaveLength(1);
  expect(r.out).not.toContain('Deploy hook accepted');
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. CI ON MAIN - ci.yml, evaluated, and the whole chain end to end
// ═══════════════════════════════════════════════════════════════════════════

/** Every workflow file in .github/workflows, parsed. */
const allWorkflows = () => fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort().map((file) => ({ file, wf: workflow(file) }));

const fieldsOf = (call) => Object.fromEntries(call.fields.map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));

/**
 * The events GitHub emits for the API calls a script made, all caused by the
 * job's GITHUB_TOKEN. A refused call emits nothing.
 */
function eventsFromCalls(calls) {
  const out = [];
  for (const c of calls) {
    if (c.refused) continue;
    let m;
    if (/^PUT repos\/[^/]+\/[^/]+\/pulls\/\d+\/merge$/.test(c.key)) {
      out.push({ name: 'push', ref: 'refs/heads/main', byGithubToken: true, cause: c.key });
    } else if ((m = /^POST repos\/[^/]+\/[^/]+\/actions\/workflows\/([^/]+)\/dispatches$/.exec(c.key))) {
      const f = fieldsOf(c);
      const inputs = Object.fromEntries(Object.entries(f).filter(([k]) => /^inputs\[/.test(k)).map(([k, v]) => [k.slice(7, -1), v]));
      const ref = f.ref.startsWith('refs/') ? f.ref : `refs/heads/${f.ref}`;
      out.push({ name: 'workflow_dispatch', workflowFile: m[1], ref, inputs, byGithubToken: true, cause: c.key });
    } else if (/^POST repos\/[^/]+\/[^/]+\/dispatches$/.test(c.key)) {
      out.push({ name: 'repository_dispatch', type: fieldsOf(c).event_type, byGithubToken: true, cause: c.key });
    } else if (/^DELETE /.test(c.key)) {
      out.push({ name: 'delete', byGithubToken: true, cause: c.key });
    }
  }
  return out;
}

/** Which workflow files an event starts. */
const started = (event) => allWorkflows().filter(({ wf, file }) => model.startsRun(wf, file, event)).map(({ file }) => file);

/** The github context of a run of ci.yml raised by `event_name` on `ref`. */
const ciContext = (event_name, ref, run_id = '9001') => ({ github: { event_name, ref, workflow: 'CI', run_id, sha: MERGE_SHA } });

test('CI can be DISPATCHED on main, still runs on every PR and every push to main, and a GITHUB_TOKEN push still starts nothing - the gap itself', () => {
  const ci = workflow('ci.yml');
  const on = triggersOf(ci);
  expect(Object.keys(on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch']);
  const starts = (event) => model.startsRun(ci, 'ci.yml', event);
  // The dispatch auto-merge makes: with GITHUB_TOKEN, on main, no inputs.
  expect(starts({ name: 'workflow_dispatch', workflowFile: 'ci.yml', ref: 'refs/heads/main', inputs: {}, byGithubToken: true })).toBe(true);
  // Unchanged: every PR, and a person's push to main.
  for (const action of ['opened', 'synchronize', 'reopened']) expect(starts({ name: 'pull_request', action, base: 'main' }), action).toBe(true);
  expect(starts({ name: 'pull_request', action: 'opened', base: 'final-product' })).toBe(true);
  expect(starts({ name: 'push', ref: 'refs/heads/main' })).toBe(true);
  expect(starts({ name: 'push', ref: 'refs/heads/claude/x' })).toBe(false);
  // The gap this closes, as GitHub documents it: the auto-merge's own push
  // to main starts no CI, whatever `push:` says.
  expect(starts({ name: 'push', ref: 'refs/heads/main', byGithubToken: true })).toBe(false);
  // ci.yml declares no inputs, so a dispatch carrying one would be refused.
  expect(starts({ name: 'workflow_dispatch', workflowFile: 'ci.yml', ref: 'refs/heads/main', inputs: { reason: 'x' }, byGithubToken: true })).toBe(false);
});

test('runs on main share ONE concurrency group and the newer cancels the older; every PR run keeps a group of its own, as before', () => {
  const { concurrency } = workflow('ci.yml');
  const group = (ctx) => model.interpolate(concurrency.group, ctx);
  const cancels = (ctx) => model.truthy(model.interpolate(concurrency['cancel-in-progress'], ctx));
  const pushMain = ciContext('push', 'refs/heads/main', '1');
  const dispatchMain = ciContext('workflow_dispatch', 'refs/heads/main', '2');
  const dispatchAgain = ciContext('workflow_dispatch', 'refs/heads/main', '3');
  expect(group(pushMain)).toBe(group(dispatchMain));
  expect(group(dispatchMain)).toBe(group(dispatchAgain));
  expect(cancels(dispatchAgain)).toBe(true);
  expect(cancels(pushMain)).toBe(true);
  // Two runs of one PR, and runs of two PRs: never grouped, never cancelled.
  const pr1 = ciContext('pull_request', 'refs/pull/7/merge', '10');
  const pr1again = ciContext('pull_request', 'refs/pull/7/merge', '11');
  const pr2 = ciContext('pull_request', 'refs/pull/8/merge', '12');
  expect(new Set([group(pr1), group(pr1again), group(pr2), group(pushMain)]).size).toBe(4);
  expect(cancels(pr1)).toBe(false);
  // Concurrency groups are repository-wide: CI's never collides with the other workflows'.
  for (const { file, wf } of allWorkflows()) {
    if (file === 'ci.yml' || !wf.concurrency) continue;
    const other = typeof wf.concurrency === 'string' ? wf.concurrency : wf.concurrency.group;
    expect(String(other), file).not.toBe(group(dispatchMain));
  }
});

test('main-state runs after EVERY other CI job, on main only, for push and dispatch, and not in a cancelled run', () => {
  const ci = workflow('ci.yml');
  const job = ci.jobs['main-state'];
  expect(job).toBeTruthy();
  const others = Object.keys(ci.jobs).filter((id) => id !== 'main-state').sort();
  // A job added to CI and not to `needs` would be red without the issue saying so.
  expect([].concat(job.needs).sort()).toEqual(others);
  const step = onlyRunStep(job);
  expect(step.run).not.toContain('${{');
  const all = (result) => Object.fromEntries(others.map((id) => [id, result]));
  const red = { ...all('success'), [others[others.length - 1]]: 'failure' };
  const runs = (ctx, needs, cancelled = false) => model.ifPasses(job.if, ctx, { cancelled, needs });
  for (const needs of [red, all('success')]) {
    expect(runs(ciContext('workflow_dispatch', 'refs/heads/main'), needs), 'dispatched on main').toBe(true);
    expect(runs(ciContext('push', 'refs/heads/main'), needs), 'push to main').toBe(true);
    expect(runs(ciContext('pull_request', 'refs/pull/7/merge'), needs), 'a PR').toBe(false);
    expect(runs(ciContext('workflow_dispatch', 'refs/heads/claude/x'), needs), 'Run workflow on a branch').toBe(false);
    expect(runs(ciContext('workflow_dispatch', 'refs/heads/main'), needs, true), 'a cancelled (superseded) run').toBe(false);
  }
});

test('THE CHAIN: the merge starts no CI, the dispatch starts exactly one CI run on main, and that run merges nothing and deploys nothing when it completes', () => {
  test.skip(!isPosix, 'executes bash');
  // 1. The merge script, executed, against the fake GitHub.
  const r = runMerge(scenarioFor(pullRequest(7)));
  expect(r.rc, r.out).toBe(0);
  const events = eventsFromCalls(r.calls);
  expect(events.map((e) => e.name)).toEqual(['push', 'delete', 'repository_dispatch', 'workflow_dispatch']);

  // 2. What each event starts, across every workflow in the repository.
  const runs = events.flatMap((e) => started(e).map((file) => ({ file, event: e })));
  expect(started(events[0]), 'the GITHUB_TOKEN merge starts nothing at all').toEqual([]);
  expect(runs.map((x) => `${x.file} <- ${x.event.name}`).sort()).toEqual([
    'ci.yml <- workflow_dispatch',
    'deploy-guarantee.yml <- repository_dispatch',
  ]);
  const ciRun = runs.find((x) => x.file === 'ci.yml');
  expect(ciRun.event.ref).toBe('refs/heads/main');

  // 3. Inside that CI run: every job runs, and main-state reports either way.
  const ci = workflow('ci.yml');
  const ctx = ciContext(ciRun.event.name, ciRun.event.ref);
  for (const [id, job] of Object.entries(ci.jobs)) {
    if (id === 'main-state') continue;
    expect(model.ifPasses(job.if, ctx), id).toBe(true);
  }
  for (const result of ['success', 'failure']) {
    const needs = Object.fromEntries([].concat(ci.jobs['main-state'].needs).map((id) => [id, result]));
    expect(model.ifPasses(ci.jobs['main-state'].if, ctx, { cancelled: false, needs }), `main-state on ${result}`).toBe(true);
  }

  // 4. Its completion is a workflow_run of CI on main. It starts the two
  //    listeners, and neither has a job that runs: auto-merge has no PR to
  //    merge, and deploy-guarantee already fired for this merge in step 2.
  for (const conclusion of ['success', 'failure']) {
    const completed = { name: 'workflow_run', workflow: ci.name, action: 'completed', headBranch: 'main' };
    expect(started(completed).sort(), conclusion).toEqual(['auto-merge.yml', 'deploy-guarantee.yml']);
    for (const file of started(completed)) {
      const { job } = onlyJob(workflow(file));
      const runCtx = workflowRunContext({ conclusion, event: ciRun.event.name, headBranch: 'main' });
      expect(model.ifPasses(job.if, runCtx), `${file} after a ${conclusion} dispatched CI`).toBe(false);
    }
    // And were auto-merge's job to run anyway, its script refuses the event itself.
    const again = runMerge(scenarioFor(pullRequest(7)), { CI_EVENT: ciRun.event.name, HEAD_BRANCH: 'main', HEAD_SHA: MERGE_SHA });
    expect(again.calls, conclusion).toEqual([]);
  }

  // 5. Contrast: a person's merge is a push that DOES start CI, and only its
  //    success fires the deploy hook - path 1, unchanged. (CI alone: other
  //    workflows filter pushes by `paths:`, which the model refuses to guess.)
  expect(model.startsRun(ci, 'ci.yml', { name: 'push', ref: 'refs/heads/main' })).toBe(true);
  const deployJob = onlyJob(workflow('deploy-guarantee.yml')).job;
  expect(model.ifPasses(deployJob.if, workflowRunContext({ conclusion: 'success', event: 'push', headBranch: 'main' }))).toBe(true);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. EXECUTED - ci.yml's main-state script against a fake gh
// ═══════════════════════════════════════════════════════════════════════════

const BOT = 'github-actions[bot]';
const MAIN_RUN = '9001';
const RED_JOB_URL = `https://github.com/${REPO}/actions/runs/${MAIN_RUN}/job/2`;
const runJobs = () => ({ total_count: 3, jobs: [
  { name: 'build', status: 'completed', conclusion: 'success', html_url: `https://github.com/${REPO}/actions/runs/${MAIN_RUN}/job/1` },
  { name: 'Visual + invariant tests (Playwright)', status: 'completed', conclusion: 'failure', html_url: RED_JOB_URL },
  { name: "Report main's state (one issue while main is red)", status: 'in_progress', conclusion: null, html_url: `https://github.com/${REPO}/actions/runs/${MAIN_RUN}/job/3` },
] });
const issue = (number, over = {}) => ({ number, state: 'open', title: 'Main is red at 0123abc', user: { login: BOT }, ...over });

/** toJSON(needs), as the workflow renders it, for the job's own `needs`. */
function needsJson(results) {
  const ids = [].concat(workflow('ci.yml').jobs['main-state'].needs);
  return JSON.stringify(Object.fromEntries(ids.map((id) => [id, { result: results[id] || 'success', outputs: {} }])), null, 2);
}

function runMainState(results, scenario, { permissions, ...over } = {}) {
  const wf = workflow('ci.yml');
  const job = wf.jobs['main-state'];
  const r = runJobScript(wf, permissions ? { ...job, permissions } : job, {
    [`GET repos/${REPO}/actions/runs/${MAIN_RUN}/jobs`]: runJobs(),
    [`POST repos/${REPO}/issues`]: { number: 150 },
    ...scenario,
  }, {
    GH_TOKEN: 'ghs_fake', REPO, TESTED_SHA: MERGE_SHA, TRIGGER: 'workflow_dispatch', RUN_ID: MAIN_RUN,
    SERVER_URL: 'https://github.com', NEEDS_JSON: needsJson(results), ...over,
  });
  const writes = r.calls.filter((c) => !c.key.startsWith('GET ') && !c.refused);
  return { ...r, writes, writeKeys: writes.map((c) => c.key) };
}

test('red on main with no issue open: ONE issue "Main is red at <sha>" naming each failing job with its own link', () => {
  test.skip(!isPosix, 'executes bash');
  const r = runMainState({ e2e: 'failure' }, { [`GET repos/${REPO}/issues`]: [] });
  expect(r.rc, r.out).toBe(0);
  expect(r.writeKeys).toEqual([`POST repos/${REPO}/issues`]);
  const f = fieldsOf(r.writes[0]);
  expect(f.title).toBe(`Main is red at ${MERGE_SHA.slice(0, 7)}`);
  expect(f.body).toContain(`- [Visual + invariant tests (Playwright)](${RED_JOB_URL})`);
  expect(f.body).not.toContain('[build]');                                  // a green job is not "failing"
  expect(f.body).toContain(`https://github.com/${REPO}/commit/${MERGE_SHA}`);
  expect(f.body).toContain(`https://github.com/${REPO}/actions/runs/${MAIN_RUN}`);
  expect(f.body).toContain('workflow_dispatch');
  expect(r.out).toContain('Opened issue #150');
  // The lookup asked for open issues by the workflow's own bot.
  const listing = r.calls.find((c) => c.key === `GET repos/${REPO}/issues`);
  expect(fieldsOf(listing)).toMatchObject({ state: 'open', creator: BOT });
});

test('red again: the bot\'s open issue is retitled and commented, never a second one; a person\'s issue and a PR with the same words are left alone', () => {
  test.skip(!isPosix, 'executes bash');
  const issues = [
    issue(91, { user: { login: 'anchittandon-create' } }),             // a person's, same words
    issue(95, { pull_request: { url: 'x' } }),                          // a PR, which the issues API also lists
    issue(90),                                                          // the bot's
    issue(97, { title: 'Something else entirely' }),
  ];
  const r = runMainState({ e2e: 'failure' }, {
    [`GET repos/${REPO}/issues`]: issues,
    [`PATCH repos/${REPO}/issues/90`]: { number: 90 },
    [`POST repos/${REPO}/issues/90/comments`]: { id: 1 },
  });
  expect(r.rc, r.out).toBe(0);
  expect(r.writeKeys).toEqual([`PATCH repos/${REPO}/issues/90`, `POST repos/${REPO}/issues/90/comments`]);
  expect(fieldsOf(r.writes[0])).toEqual({ title: `Main is red at ${MERGE_SHA.slice(0, 7)}` });
  expect(fieldsOf(r.writes[1]).body).toContain(RED_JOB_URL);
  expect(r.out).toContain('Updated issue #90');
});

test('green on main closes the open issue with a comment; green with none open, and an undecided run, write nothing', () => {
  test.skip(!isPosix, 'executes bash');
  const green = runMainState({}, {
    [`GET repos/${REPO}/issues`]: [issue(90)],
    [`PATCH repos/${REPO}/issues/90`]: { number: 90, state: 'closed' },
    [`POST repos/${REPO}/issues/90/comments`]: { id: 2 },
  });
  expect(green.rc, green.out).toBe(0);
  expect(green.writeKeys).toEqual([`POST repos/${REPO}/issues/90/comments`, `PATCH repos/${REPO}/issues/90`]);
  expect(fieldsOf(green.writes[0]).body).toContain(`Main is green again at [\`${MERGE_SHA.slice(0, 7)}\`]`);
  expect(fieldsOf(green.writes[1])).toEqual({ state: 'closed', state_reason: 'completed' });

  const nothingOpen = runMainState({}, { [`GET repos/${REPO}/issues`]: [issue(91, { user: { login: 'someone' } })] });
  expect(nothingOpen.rc, nothingOpen.out).toBe(0);
  expect(nothingOpen.writes).toEqual([]);

  // A job skipped or cancelled on its own is neither green nor red: say so, touch nothing.
  const undecided = runMainState({ e2e: 'cancelled' }, { [`GET repos/${REPO}/issues`]: [issue(90)] });
  expect(undecided.rc, undecided.out).toBe(0);
  expect(undecided.calls).toEqual([]);
  expect(undecided.out).toContain("Main's state not decided");
});

test('bookkeeping failures: green never turns main red, red that cannot be written says so and fails, unreadable job links still report the run', () => {
  test.skip(!isPosix, 'executes bash');
  // Green, but the issues cannot be listed, or the close is refused: a warning, exit 0.
  const unlisted = runMainState({}, { [`GET repos/${REPO}/issues`]: { http: 502, message: 'Bad Gateway' } });
  expect(unlisted.rc, unlisted.out).toBe(0);
  expect(unlisted.writes).toEqual([]);
  expect(unlisted.out).toContain('::warning::');
  const unclosable = runMainState({}, {
    [`GET repos/${REPO}/issues`]: [issue(90)],
    [`POST repos/${REPO}/issues/90/comments`]: { http: 500, message: 'oops' },
  });
  expect(unclosable.rc, unclosable.out).toBe(0);
  expect(unclosable.out).toContain('::warning::Main is green at');

  // Red and the jobs cannot be read: still ONE issue, naming the failing job and the run.
  const nolinks = runMainState({ build: 'failure' }, {
    [`GET repos/${REPO}/issues`]: [],
    [`GET repos/${REPO}/actions/runs/${MAIN_RUN}/jobs`]: { http: 404, message: 'Not Found' },
  });
  expect(nolinks.rc, nolinks.out).toBe(0);
  expect(nolinks.writeKeys).toEqual([`POST repos/${REPO}/issues`]);
  expect(fieldsOf(nolinks.writes[0]).body).toContain(`- build: see [run ${MAIN_RUN}](https://github.com/${REPO}/actions/runs/${MAIN_RUN})`);

  // Red and the issue cannot be opened: loud, and the job fails (the run is red already).
  const unwritable = runMainState({ e2e: 'failure' }, {
    [`GET repos/${REPO}/issues`]: [],
    [`POST repos/${REPO}/issues`]: { http: 410, message: 'Issues are disabled for this repo' },
  });
  expect(unwritable.rc).not.toBe(0);
  expect(unwritable.out).toMatch(/::error::Main is red at [0-9a-f]{7}, and the "Main is red" issue could not be opened/);
});

test('the job\'s own permissions are what let it write: without issues:write, GitHub refuses the issue and the job says so', () => {
  test.skip(!isPosix, 'executes bash');
  const { issues, ...withoutIssues } = workflow('ci.yml').jobs['main-state'].permissions;
  expect(issues).toBe('write');
  const r = runMainState({ e2e: 'failure' }, { [`GET repos/${REPO}/issues`]: [] }, { permissions: withoutIssues });
  const attempt = r.calls.find((c) => c.key === `POST repos/${REPO}/issues`);
  expect(attempt.refused).toBe(403);
  expect(r.rc).not.toBe(0);
  expect(r.out).toContain("does this job still have 'issues: write'?");
});
