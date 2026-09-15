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
// Workflows cannot be executed here, so this spec does two different things
// and is explicit about which is which:
//
// 1. FILE-PROPERTY checks on the parsed YAML: which event fires the workflow,
//    what the job `if` is gated on, which permissions the token carries, that
//    no step pulls a third-party action. Those are claims about the FILE, and a
//    parsed-file check is the right tool - the same judgement CLAUDE.md records
//    for "a migration must contain the revoke".
// 2. EXECUTED checks: each workflow's `run:` script is pulled out of the parsed
//    YAML and RUN under bash with a fake `gh` and a fake `curl` on PATH that
//    record every call and answer from a scenario. That is where the merge /
//    skip / refuse logic lives, and reading it would prove nothing - a script
//    that logged "refused" and merged anyway would pass a text check. The
//    scripts' inputs are the workflow's own `env:` block, so an env key added
//    to the YAML without a value here makes the script fail under `set -u`
//    rather than run with a hole.
//
// Run: npx playwright test tests/workflows-guarantees.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const SIS = 'snowflake-streamlit-app';
const REPO = 'Anchit-AI-Hustle/lifecycle-os';
const HEAD = '6f17c2a36d79f004532e5e89af6b1b1785134cd3';      // a real PR head on main's history
const MERGE_SHA = '254e5999d513d2ba9bb913d74dd8846ce6ef06ef'; // the merge commit that made it
const THIS_RUN = '4242424242';

// ── YAML ────────────────────────────────────────────────────────────────────
// No YAML library is a dependency of this repo. Prefer one if it ever appears
// in node_modules; otherwise PyYAML through python3, which ubuntu-latest and
// this sandbox both ship. PyYAML is YAML 1.1, so the bare `on:` key parses as
// the boolean true - `triggersOf()` reads both spellings.

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
const key = method.toUpperCase() + ' ' + String(endpoint).replace(/\\?.*$/, '');
const log = process.env.FAKE_GH_LOG;
const prior = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const nth = prior.filter((c) => c.key === key).length;
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
  ...over,
});

function runMerge(scenario, eventOver = {}) {
  const dir = sandbox();
  const { job } = onlyJob(workflow('auto-merge.yml'));
  const scriptPath = path.join(dir, 'merge.sh');
  fs.writeFileSync(scriptPath, onlyRunStep(job).run);
  const scenarioPath = path.join(dir, 'scenario.json');
  fs.writeFileSync(scenarioPath, JSON.stringify(scenario));
  const logPath = path.join(dir, 'gh-calls.jsonl');
  const env = envFromJob(job, {
    GH_TOKEN: 'ghs_fake', REPO, HEAD_SHA: HEAD, HEAD_BRANCH: 'claude/change-7', HEAD_REPO: REPO,
    CI_RUN_ID: '777', CI_RUN_URL: 'https://github.com/x/actions/runs/777', THIS_RUN_ID: THIS_RUN,
    ...eventOver,
  });
  Object.assign(env, { PATH: dir + path.delimiter + process.env.PATH, FAKE_GH_LOG: logPath, FAKE_GH_SCENARIO: scenarioPath, POLL_SECONDS: '0' });
  const r = spawnSync('bash', [scriptPath], { env, encoding: 'utf8', timeout: 60000 });
  const calls = readCalls(logPath);
  return {
    rc: r.status, out: (r.stdout || '') + (r.stderr || ''), calls,
    merges: calls.filter((c) => c.key.startsWith('PUT ') && c.key.endsWith('/merge')),
    dispatches: calls.filter((c) => c.key === `POST repos/${REPO}/dispatches`),
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
// 1. FILE PROPERTIES - auto-merge.yml
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

test('the merge job is gated on workflow_run.conclusion == success, in the job itself', () => {
  const { job } = onlyJob(workflow('auto-merge.yml'));
  expect(job.if).toContain("github.event.workflow_run.conclusion == 'success'");
  expect(job.if).toContain("github.event.workflow_run.event == 'pull_request'");
  expect(job['runs-on']).toBe('ubuntu-latest');
});

test('the head-ref guard against the SiS branch lives in the JOB, not only in protect-main-from-sis.yml', () => {
  const { job } = onlyJob(workflow('auto-merge.yml'));
  expect(job.if).toContain(`github.event.workflow_run.head_branch != '${SIS}'`);
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

test('permissions are least-privilege in both files: {} at the top, exactly two write scopes on the merge job, none on deploy', () => {
  const am = workflow('auto-merge.yml');
  const dg = workflow('deploy-guarantee.yml');
  expect(am.permissions).toEqual({});
  expect(dg.permissions).toEqual({});
  expect(onlyJob(am).job.permissions).toEqual({ 'pull-requests': 'write', contents: 'write' });
  expect(onlyJob(dg).job.permissions).toBeUndefined();
  for (const wf of [am, dg]) {
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
  // Every read happened BEFORE the write.
  const firstPut = r.calls.findIndex((c) => c.key.startsWith('PUT '));
  const lastGet = r.calls.map((c) => c.key.startsWith('GET ')).lastIndexOf(true);
  expect(firstPut).toBeGreaterThan(-1);
  expect(lastGet).toBeLessThan(firstPut);
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
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. FILE PROPERTIES - deploy-guarantee.yml
// ═══════════════════════════════════════════════════════════════════════════

test('deploy-guarantee chains on CI succeeding for a push to main, and can also be fired by auto-merge or by hand', () => {
  const wf = workflow('deploy-guarantee.yml');
  const on = triggersOf(wf);
  expect(on.workflow_run.workflows).toEqual(['CI']);
  expect(on.workflow_run.types).toEqual(['completed']);
  expect(on.workflow_run.branches).toEqual(['main']);
  expect(on.repository_dispatch.types).toEqual(['deploy-guarantee']);
  expect(on).toHaveProperty('workflow_dispatch');
  const { job } = onlyJob(wf);
  expect(job.if).toContain("github.event.workflow_run.conclusion == 'success'");
  expect(job.if).toContain("github.event.workflow_run.head_branch == 'main'");
  expect(job.if).toContain("github.event.workflow_run.event == 'push'");
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
