// The preset harvest READS on a pull request and PUBLISHES only from a
// dispatch, on a branch of its own.
//
// Found 2026-10-04: the harvest workflow committed 40 brands' regenerated data
// onto whichever same-repository PR touched the reader. #131 (a document-fetch
// lockdown) got 5c06501 - a data commit its author never asked for - and that
// bot push produced `action_required` runs on the commit. Now:
//
//   pull_request       read and report (summary + artifact), commit nothing;
//                      the job holds a read-only token.
//   workflow_dispatch  read, then a SEPARATE job publishes onto
//                      `claude/harvest-presets-<run id>` with its own PR, and
//                      only when dispatched on the default branch.
//   the bot's commit   carries `[skip ci]`, so GitHub starts no run for it.
//
// Same split as workflows-guarantees.spec.js, stated per test:
//   FILE-PROPERTY checks on the parsed YAML (triggers, which job holds which
//   token, which job runs for which event) - claims about the file.
//   EXECUTED checks: the publish step's `run:` script is pulled out of the
//   parsed YAML and RUN under bash in a real git clone of a real (local, bare)
//   remote, with a fake `gh` that records the PR it was asked to open. What is
//   asserted is what reached the remote: which refs moved, what the commit
//   holds, what its message says.
//
// Run: npx playwright test tests/harvest-workflow.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, '.github', 'workflows', 'harvest-presets.yml');
const REPO = 'Anchit-AI-Hustle/lifecycle-os';
const RUN_ID = '987654321';

// No YAML library is a dependency; PyYAML through python3 (ubuntu-latest and
// this sandbox both ship it), as workflows-guarantees.spec.js does. YAML 1.1
// parses the bare `on:` key as the boolean true.
function parseYaml(absPath) {
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
  if (r.status !== 0) throw new Error(`no YAML parser available: ${r.stderr || r.error}`);
  return JSON.parse(r.stdout);
}

const wf = parseYaml(FILE);
const triggers = wf.on || wf.true || wf.True;
const publishStep = () => {
  const steps = wf.jobs.publish.steps.filter((s) => typeof s.run === 'string' && /git push/.test(s.run));
  expect(steps, 'exactly one step in the publish job pushes').toHaveLength(1);
  return steps[0];
};

/* ═══ file properties: who runs when, holding what ════════════════════════ */

test('a pull request runs only the read job, with a read-only token; publishing is a dispatch-only job', () => {
  expect(Object.keys(triggers).sort()).toEqual(['pull_request', 'workflow_dispatch']);
  expect(triggers.pull_request.paths).toEqual(expect.arrayContaining(['api/_shared/brand-render.js', 'scripts/harvest-presets.js']));
  expect(wf.permissions).toEqual({ contents: 'read' });
  expect(Object.keys(wf.jobs).sort()).toEqual(['harvest', 'publish']);

  // The read job cannot write: its token has nothing but contents: read, so
  // no step in it can push or open a PR whatever the step says.
  expect(wf.jobs.harvest.permissions).toEqual({ contents: 'read' });
  // The publish job alone holds write scopes, needs the read to have passed,
  // and is gated on a dispatch in the job itself.
  expect(wf.jobs.publish.permissions).toEqual({ contents: 'write', 'pull-requests': 'write', actions: 'read' });
  expect(wf.jobs.publish.needs).toBe('harvest');
  expect(wf.jobs.publish.if).toBe("github.event_name == 'workflow_dispatch'");
  // The data handed from one job to the other is uploaded only for a dispatch.
  const dataUpload = wf.jobs.harvest.steps.find((s) => s.with && /^preset-data-/.test(String(s.with.name || '')));
  expect(dataUpload.if).toBe("github.event_name == 'workflow_dispatch'");
});

/* ═══ executed: the publish script against a real remote ══════════════════ */

// `gh run download` is modelled with the one behaviour that matters and that
// the first real dispatch hit: it REFUSES to overwrite a file that exists
// ("error extracting zip archive: ... file exists"), so a download straight
// into the checked-out tree fails.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
if (args[0] === 'run' && args[1] === 'download') {
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : ''; };
  fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ key: 'RUN DOWNLOAD ' + args[2], fields: ['repo=' + opt('--repo'), 'name=' + opt('--name')] }) + '\\n');
  const src = process.env.FAKE_ARTIFACT_DIR;
  const dest = opt('--dir') || '.';
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(src)) {
    const rel = path.relative(src, f);
    const to = path.join(dest, rel);
    if (fs.existsSync(to)) { process.stderr.write('error downloading ' + opt('--name') + ': error extracting zip archive: error extracting "' + rel + '": open ' + path.resolve(to) + ': file exists\\n'); process.exit(1); }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(f, to);
  }
  process.exit(0);
}
if (args[0] !== 'api') { process.stderr.write('fake gh: only "gh api" and "gh run download" are modelled\\n'); process.exit(2); }
let method = 'GET', endpoint = null; const fields = [];
for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === '-X' || a === '--method') { method = args[++i]; continue; }
  if (a === '-f' || a === '-F' || a === '--raw-field' || a === '--field') { fields.push(args[++i]); continue; }
  if (a === '--jq' || a === '-q' || a === '-H' || a === '--header') { i++; continue; }
  if (a.startsWith('-')) continue;
  if (endpoint === null) endpoint = a;
}
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ key: method.toUpperCase() + ' ' + endpoint, fields }) + '\\n');
process.stdout.write('https://github.com/${REPO}/pull/4242');
`;

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * A bare remote with `main` and an unrelated PR branch, and a clone of it at
 * `checkoutRef` - the tree the publish job checks out. `change` edits the
 * clone the way the downloaded artifact does.
 */
function world({ checkoutRef = 'main', change = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvest-wf-'));
  const remote = path.join(dir, 'remote.git');
  const seed = path.join(dir, 'seed');
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote);
  git(dir, 'init', '-q', '-b', 'main', seed);
  git(seed, 'config', 'user.email', 'seed@example.test');
  git(seed, 'config', 'user.name', 'seed');
  fs.mkdirSync(path.join(seed, 'data', 'brands', 'observed'), { recursive: true });
  fs.mkdirSync(path.join(seed, 'data', 'brands', 'presets'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'data', 'brands', 'observed', 'airtel.observed.json'), '{"renderer":"blocked"}\n');
  fs.writeFileSync(path.join(seed, 'data', 'brands', 'presets', 'index.json'), '{"presets":[]}\n');
  fs.writeFileSync(path.join(seed, 'README.md'), 'seed\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'seed');
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', '-q', 'origin', 'main');
  // Somebody's open PR, which a harvest must never touch.
  git(seed, 'checkout', '-q', '-b', 'claude/document-fetch-lockdown');
  fs.writeFileSync(path.join(seed, 'README.md'), 'a PR\n');
  git(seed, 'commit', '-q', '-am', 'a PR');
  git(seed, 'push', '-q', 'origin', 'claude/document-fetch-lockdown');

  const work = path.join(dir, 'work');
  git(dir, 'clone', '-q', '--branch', checkoutRef, remote, work);
  if (change) {
    fs.writeFileSync(path.join(work, 'data', 'brands', 'observed', 'airtel.observed.json'), '{"renderer":"rendered","palette":{"primary":"#d40000"}}\n');
    fs.writeFileSync(path.join(work, 'data', 'brands', 'presets', 'index.json'), '{"presets":[{"slug":"airtel"}]}\n');
  }
  // Something else changed in the tree: it must not ride along.
  fs.writeFileSync(path.join(work, 'README.md'), 'not harvested data\n');

  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
  return { dir, remote, work, bin, ghLog: path.join(dir, 'gh.log') };
}

const refs = (remote) => Object.fromEntries(git(remote, 'for-each-ref', '--format=%(refname:short) %(objectname)').split('\n').filter(Boolean).map((l) => l.split(' ')));
const ghCalls = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/** Run the publish step's own script with its own env keys. */
function publish(w, { event = 'workflow_dispatch', ref = 'main', base = 'main' } = {}) {
  const step = publishStep();
  const supplied = { GH_TOKEN: 'fake-token', REPO, BASE: base, REF: ref, EVENT: event, RUN_ID };
  const env = { ...process.env, PATH: `${w.bin}:${process.env.PATH}`, FAKE_GH_LOG: w.ghLog, GITHUB_STEP_SUMMARY: path.join(w.dir, 'summary.md'), GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of Object.keys(step.env || {})) {
    // Every env key the step declares must be supplied here: an unknown one
    // stays unset and `set -u` fails the script rather than running with a hole.
    if (k in supplied) env[k] = supplied[k]; else delete env[k];
  }
  return spawnSync('bash', ['-e', '-c', step.run], { cwd: w.work, env, encoding: 'utf8' });
}

/** Run the fetch step's own script: the read job's artifact into the tree. */
function fetchStep(w, artifact) {
  const steps = wf.jobs.publish.steps.filter((s) => typeof s.run === 'string' && /gh run download/.test(s.run));
  expect(steps, 'exactly one step downloads the data').toHaveLength(1);
  const step = steps[0];
  const supplied = { GH_TOKEN: 'fake-token', REPO, RUN_ID, DL: path.join(w.dir, 'runner-temp', 'preset-data') };
  const env = { ...process.env, PATH: `${w.bin}:${process.env.PATH}`, FAKE_GH_LOG: w.ghLog, FAKE_ARTIFACT_DIR: artifact };
  for (const k of Object.keys(step.env || {})) { if (k in supplied) env[k] = supplied[k]; else delete env[k]; }
  return spawnSync('bash', ['-e', '-c', step.run], { cwd: w.work, env, encoding: 'utf8' });
}

/** The artifact the read job uploads: observed/ and presets/ under one root. */
function artifactDir(w) {
  const a = path.join(w.dir, 'artifact');
  fs.mkdirSync(path.join(a, 'observed'), { recursive: true });
  fs.mkdirSync(path.join(a, 'presets'), { recursive: true });
  fs.writeFileSync(path.join(a, 'observed', 'airtel.observed.json'), '{"renderer":"rendered","palette":{"primary":"#d40000"}}\n');
  fs.writeFileSync(path.join(a, 'observed', 'nike.observed.json'), '{"renderer":"blocked"}\n');
  fs.writeFileSync(path.join(a, 'presets', 'index.json'), '{"presets":[{"slug":"airtel"},{"slug":"nike"}]}\n');
  return a;
}

test('the read job\'s data replaces the tree\'s, even though every file in it already exists, and is what gets published', () => {
  const w = world({ change: false });
  const artifact = artifactDir(w);
  const r = fetchStep(w, artifact);
  expect(r.status, r.stderr).toBe(0);
  for (const rel of ['observed/airtel.observed.json', 'observed/nike.observed.json', 'presets/index.json']) {
    expect(fs.readFileSync(path.join(w.work, 'data', 'brands', rel), 'utf8'), rel).toBe(fs.readFileSync(path.join(artifact, rel), 'utf8'));
  }
  expect(ghCalls(w.ghLog)[0]).toEqual({ key: `RUN DOWNLOAD ${RUN_ID}`, fields: [`repo=${REPO}`, `name=preset-data-${RUN_ID}`] });
  // And the publish step then commits exactly that data.
  const p = publish(w);
  expect(p.status, p.stderr).toBe(0);
  const branch = `claude/harvest-presets-${RUN_ID}`;
  expect(git(w.remote, 'diff', '--name-only', `${branch}~1`, branch).split('\n').sort())
    .toEqual(['data/brands/observed/airtel.observed.json', 'data/brands/observed/nike.observed.json', 'data/brands/presets/index.json']);
});

test('a dispatch on the default branch publishes on claude/harvest-presets-<run id>, with [skip ci], data only, and opens its own PR', () => {
  const w = world();
  const before = refs(w.remote);
  const r = publish(w);
  expect(r.status, r.stderr).toBe(0);
  const after = refs(w.remote);
  const branch = `claude/harvest-presets-${RUN_ID}`;
  // Exactly one new ref, and no existing ref moved - not main, not the PR.
  expect(Object.keys(after).sort()).toEqual([...Object.keys(before), branch].sort());
  for (const [name, sha] of Object.entries(before)) expect(after[name], `${name} moved`).toBe(sha);
  // The new branch is one commit on top of what was read.
  expect(git(w.remote, 'rev-parse', `${branch}~1`)).toBe(before.main);
  const message = git(w.remote, 'log', '-1', '--format=%B', branch);
  expect(message).toContain('[skip ci]');
  expect(message.split('\n')[0]).toMatch(/^Starter brands read from their own rendered sites \(\d{4}-\d{2}-\d{2}\) \[skip ci\]$/);
  expect(git(w.remote, 'log', '-1', '--format=%an', branch)).toBe('github-actions[bot]');
  // Only the harvested data is in it; the other change in the tree is not.
  expect(git(w.remote, 'diff', '--name-only', `${branch}~1`, branch).split('\n').sort())
    .toEqual(['data/brands/observed/airtel.observed.json', 'data/brands/presets/index.json']);
  // One PR, from that branch, into the default branch.
  const calls = ghCalls(w.ghLog);
  expect(calls.map((c) => c.key)).toEqual([`POST repos/${REPO}/pulls`]);
  const fields = Object.fromEntries(calls[0].fields.map((f) => [f.slice(0, f.indexOf('=')), f.slice(f.indexOf('=') + 1)]));
  expect(fields.head).toBe(branch);
  expect(fields.base).toBe('main');
  expect(fields.body).toMatch(/\[skip ci\]/);
  expect(fields.body).toMatch(new RegExp(`run ${RUN_ID}`));
});

test('a dispatch on any other branch reads and reports only: nothing is pushed anywhere', () => {
  const w = world({ checkoutRef: 'claude/document-fetch-lockdown' });
  const before = refs(w.remote);
  const r = publish(w, { ref: 'claude/document-fetch-lockdown' });
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/Dispatched on claude\/document-fetch-lockdown, not main: read and reported only/);
  expect(refs(w.remote)).toEqual(before);
  expect(ghCalls(w.ghLog)).toEqual([]);
});

test('a pull_request event reaching the script anyway publishes nothing', () => {
  const w = world();
  const before = refs(w.remote);
  const r = publish(w, { event: 'pull_request', ref: '131/merge' });
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/Only a dispatched harvest publishes; this was pull_request/);
  expect(refs(w.remote)).toEqual(before);
  expect(ghCalls(w.ghLog)).toEqual([]);
});

test('a read that changed no data pushes no branch and opens no PR', () => {
  const w = world({ change: false });
  const before = refs(w.remote);
  const r = publish(w);
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/Nothing changed/);
  expect(refs(w.remote)).toEqual(before);
  expect(ghCalls(w.ghLog)).toEqual([]);
});
