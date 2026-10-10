// scripts/connect-supabase-project.sh points production at a Supabase project
// with the Supabase CLI and the Vercel CLI. It is EXECUTED here, unmodified,
// under bash, in a throwaway git repository (a clone of a local bare remote,
// so `origin/main` is real), with:
//   - a fake `supabase` and a fake `vercel` on SUPABASE_BIN / VERCEL_BIN that
//     record every invocation (argv, and stdin for `env add`) and answer the
//     way the real CLIs' JSON outputs do;
//   - a local HTTP server standing in for the deployment's
//     /api/public-config?action=auth&op=status, which answers "supabase" only
//     after the fake `vercel redeploy` ran.
// What is asserted is what the CLIs were asked to do: which commands, in which
// order, which values reached Vercel and on which targets, and that no secret
// ever appeared on a command line or in the script's output.
//
// Run: npx playwright test tests/connect-supabase-script.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'connect-supabase-project.sh');
const REF = 'dypkppctdbmsiqclnhzx';
const OTHER_REF = 'fswdwmkgggzyxrdzabnh';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => [b64u({ alg: 'HS256', typ: 'JWT' }), b64u(payload), 'c2lnbmF0dXJl'].join('.');
const SERVICE = jwt({ iss: 'supabase', ref: REF, role: 'service_role', iat: 1, exp: 2 });
const ANON = jwt({ iss: 'supabase', ref: REF, role: 'anon', iat: 1, exp: 2 });
const PUBLISHABLE = 'sb_publishable_testkey0123456789';
const SB_SECRET = 'sb_secret_testsecret0123456789';
const STORED_VALUE = 'stored-value-never-printed-0123456789';

const KEYS_LEGACY = [
  { name: 'anon', api_key: ANON, type: 'legacy' },
  { name: 'service_role', api_key: SERVICE, type: 'legacy' },
  { name: 'default', api_key: PUBLISHABLE, type: 'publishable' },
  { name: 'default', api_key: SB_SECRET, type: 'secret' },
];

// --- the fake CLIs ---------------------------------------------------------
const FAKE_SUPABASE = `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const sc = JSON.parse(fs.readFileSync(process.env.FAKE_SCENARIO, 'utf8'));
const argv = process.argv.slice(2);
const rec = (x) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(Object.assign({ cli: 'supabase', argv }, x || {})) + '\\n');
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const cmd = argv[0] + ' ' + argv[1];
if (cmd === 'projects list') {
  rec();
  if (sc.supabaseRefused) { process.stderr.write('Unauthorized\\n'); process.exit(1); }
  process.stdout.write(JSON.stringify(sc.projects)); process.exit(0);
}
if (argv[0] === 'login' || argv[0] === 'link' || cmd === 'migration list') { rec(); process.exit(0); }
if (cmd === 'db push') {
  rec();
  if (sc.pushFails && !argv.includes('--dry-run')) { process.stderr.write('ERROR: relation already exists\\n'); process.exit(1); }
  process.exit(0);
}
if (cmd === 'config push') {
  const toml = fs.readFileSync(path.join(opt('--workdir'), 'supabase', 'config.toml'), 'utf8');
  rec({ site_url: (toml.match(/^site_url\\s*=\\s*"(.*)"$/m) || [])[1] || null });
  process.exit(0);
}
if (cmd === 'projects api-keys') { rec(); process.stdout.write(JSON.stringify(sc.keys)); process.exit(0); }
rec({ unknown: true }); process.exit(9);
`;

const FAKE_VERCEL = `#!/usr/bin/env node
const fs = require('fs');
const sc = JSON.parse(fs.readFileSync(process.env.FAKE_SCENARIO, 'utf8'));
const argv = process.argv.slice(2);
const a = [];
for (let i = 0; i < argv.length; i++) { if (argv[i] === '--cwd' || argv[i] === '--token') { i++; continue; } a.push(argv[i]); }
const rec = (x) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(Object.assign({ cli: 'vercel', argv, args: a }, x || {})) + '\\n');
if (a[0] === 'whoami' || a[0] === 'login' || a[0] === 'link') { rec(); process.exit(0); }
if (a[0] === 'env' && a[1] === 'ls') {
  rec();
  process.stdout.write(JSON.stringify({ envs: sc.existing.map((key) => ({ key, value: '${STORED_VALUE}', target: ['production'] })) }));
  process.exit(0);
}
if (a[0] === 'env' && a[1] === 'add') {
  let input = '';
  process.stdin.on('data', (d) => { input += d; }).on('end', () => {
    rec({ name: a[2], target: a[3], value: input, sensitive: a.includes('--sensitive'), notSensitive: a.includes('--no-sensitive'), force: a.includes('--force') });
    process.exit(0);
  });
  return;
}
if (a[0] === 'inspect') { rec(); process.stdout.write(JSON.stringify({ id: 'dpl_fake123', url: 'lifecycle-os-abc.vercel.app' })); process.exit(0); }
if (a[0] === 'redeploy') { rec(); if (!sc.redeployDoesNotFlip) fs.writeFileSync(process.env.FAKE_DEPLOYED, '1'); process.stdout.write('https://lifecycle-os-new.vercel.app\\n'); process.exit(0); }
rec({ unknown: true }); process.exit(9);
`;

// --- one run ---------------------------------------------------------------
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcos-connect-'));
  const bare = path.join(dir, 'origin.git');
  const repo = path.join(dir, 'repo');
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' };
  spawnSync('git', ['init', '--bare', '-q', '-b', 'main', bare], { env });
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'supabase', 'migrations'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(repo, 'scripts', 'connect-supabase-project.sh'));
  fs.copyFileSync(path.join(ROOT, 'supabase', 'config.toml'), path.join(repo, 'supabase', 'config.toml'));
  fs.writeFileSync(path.join(repo, 'supabase', 'migrations', '20260101000000_x.sql'), 'select 1;\n');
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-qm', 'base'], ['remote', 'add', 'origin', bare], ['push', '-q', 'origin', 'main']]) {
    const r = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  }
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'supabase'), FAKE_SUPABASE, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'vercel'), FAKE_VERCEL, { mode: 0o755 });
  return { dir, repo, bin, env };
}

function statusServer(deployedFlag) {
  const server = http.createServer((req, res) => {
    const deployed = fs.existsSync(deployedFlag);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(deployed ? { mode: 'supabase' } : { mode: 'device', reason: 'no_database_url' }));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

async function run(scenario, extraEnv = {}) {
  const ws = workspace();
  const log = path.join(ws.dir, 'calls.jsonl');
  const deployed = path.join(ws.dir, 'deployed');
  fs.writeFileSync(path.join(ws.dir, 'scenario.json'), JSON.stringify(Object.assign({
    projects: [{ id: REF, ref: REF, name: 'lifecycle-os', status: 'ACTIVE_HEALTHY' }],
    keys: KEYS_LEGACY,
    existing: ['CRON_SECRET', 'GEMINI_API_KEY'],
  }, scenario)));
  fs.writeFileSync(log, '');
  const server = await statusServer(deployed);
  const site = `http://127.0.0.1:${server.address().port}`;
  const result = await new Promise((ok) => {
    const child = spawn('bash', [path.join(ws.repo, 'scripts', 'connect-supabase-project.sh')], {
      cwd: ws.repo,
      env: Object.assign({}, ws.env, {
        SUPABASE_BIN: path.join(ws.bin, 'supabase'),
        VERCEL_BIN: path.join(ws.bin, 'vercel'),
        SUPABASE_ACCESS_TOKEN: 'sbp_fake_access_token',
        VERCEL_TOKEN: 'vercel_fake_token',
        SITE_URL: site,
        CONNECT_WAIT_SECONDS: '8',
        FAKE_SCENARIO: path.join(ws.dir, 'scenario.json'),
        FAKE_LOG: log,
        FAKE_DEPLOYED: deployed,
      }, extraEnv),
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.on('close', (status) => { clearTimeout(timer); ok({ status, out }); });
  });
  server.close();
  const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return Object.assign(result, { calls, site, ws });
}

const supabaseCmds = (calls) => calls.filter((c) => c.cli === 'supabase').map((c) => c.argv.slice(0, 2).join(' ') + (c.argv.includes('--dry-run') ? ' --dry-run' : ''));
const envAdds = (calls) => calls.filter((c) => c.cli === 'vercel' && c.args[0] === 'env' && c.args[1] === 'add');
const valueOf = (calls, name, target) => (envAdds(calls).find((c) => c.name === name && c.target === target) || {}).value;
const everyArgv = (calls) => calls.map((c) => c.argv.join(' ')).join('\n');

test.describe('connect-supabase-project.sh, executed with fake CLIs', () => {
  test.describe.configure({ mode: 'parallel' });

  test('applies the schema, writes the keys to Vercel on stdin only, redeploys and waits for Supabase mode', async () => {
    const r = await run({});
    expect(r.status, r.out).toBe(0);

    // Supabase, in order: who am I, link, the dry run, the push, the list, the auth settings, the keys.
    expect(supabaseCmds(r.calls)).toEqual([
      'projects list', 'link --project-ref', 'db push --dry-run', 'db push', 'migration list', 'config push', 'projects api-keys',
    ]);
    const link = r.calls.find((c) => c.cli === 'supabase' && c.argv[0] === 'link');
    expect(link.argv).toEqual(['link', '--project-ref', REF]);
    const push = r.calls.filter((c) => c.cli === 'supabase' && c.argv[0] === 'db');
    for (const p of push) expect(p.argv).toEqual(expect.arrayContaining(['--linked', '--include-all']));
    // The auth settings went out with the deployment as site_url, not localhost.
    expect(r.calls.find((c) => c.argv[0] === 'config').site_url).toBe(r.site);

    // Vercel: the new project's URL and keys on all three targets.
    for (const t of ['production', 'preview', 'development']) {
      expect(valueOf(r.calls, 'SUPABASE_URL', t)).toBe(`https://${REF}.supabase.co`);
      expect(valueOf(r.calls, 'NEXT_PUBLIC_SUPABASE_URL', t)).toBe(`https://${REF}.supabase.co`);
      expect(valueOf(r.calls, 'SUPABASE_ANON_KEY', t)).toBe(ANON);
      expect(valueOf(r.calls, 'NEXT_PUBLIC_SUPABASE_ANON_KEY', t)).toBe(ANON);
      expect(valueOf(r.calls, 'SUPABASE_SERVICE_ROLE_KEY', t)).toBe(SERVICE);
    }
    for (const c of envAdds(r.calls)) {
      expect(c.force, `${c.name} ${c.target}`).toBe(true);
      if (c.target === 'development') expect(c.notSensitive, c.name).toBe(true);
      else expect(c.sensitive, `${c.name} ${c.target}`).toBe(true);
    }
    // A new pepper and connection key, ONE value shared by production and
    // preview (one project, one auth table), never on development.
    const pepper = valueOf(r.calls, 'MOBILE_PIN_PEPPER', 'production');
    expect(pepper && pepper.length).toBeGreaterThanOrEqual(32);
    expect(valueOf(r.calls, 'MOBILE_PIN_PEPPER', 'preview')).toBe(pepper);
    expect(valueOf(r.calls, 'MOBILE_PIN_PEPPER', 'development')).toBeUndefined();
    const connKey = valueOf(r.calls, 'CONNECTION_SECRET_KEY', 'production');
    expect(connKey).toMatch(/^[0-9a-f]{64}$/);
    expect(valueOf(r.calls, 'CONNECTION_SECRET_KEY', 'preview')).toBe(connKey);
    expect(valueOf(r.calls, 'CONNECTION_SECRET_KEY', 'development')).toBeUndefined();

    // The production deployment found by inspect is the one redeployed, to production.
    const redeploy = r.calls.find((c) => c.cli === 'vercel' && c.args[0] === 'redeploy');
    expect(redeploy.args).toEqual(['redeploy', 'dpl_fake123', '--target', 'production']);
    expect(r.out).toContain('answers mode supabase');
    expect(r.out).toContain(`now uses Supabase project ${REF}`);

    // No secret on any command line, none in the output, and the stored
    // values the env listing returned were never printed.
    for (const secret of [SERVICE, ANON, SB_SECRET, pepper, connKey]) {
      expect(everyArgv(r.calls)).not.toContain(secret);
      expect(r.out).not.toContain(secret);
    }
    expect(r.out).not.toContain(STORED_VALUE);
    // Every Vercel command ran outside the repository, so `vercel link` left nothing in it.
    expect(fs.existsSync(path.join(r.ws.repo, '.vercel'))).toBe(false);
    for (const c of r.calls.filter((x) => x.cli === 'vercel')) expect(c.argv[0], c.args.join(' ')).toBe('--cwd');
  });

  test('a pepper or connection key that exists is kept: rotating either breaks every PIN or stored secret', async () => {
    const r = await run({ existing: ['CRON_SECRET', 'MOBILE_PIN_PEPPER', 'CONNECTION_SECRET_KEY'] });
    expect(r.status, r.out).toBe(0);
    const names = envAdds(r.calls).map((c) => c.name);
    expect(names).not.toContain('MOBILE_PIN_PEPPER');
    expect(names).not.toContain('CONNECTION_SECRET_KEY');
    expect(names).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(r.out).toContain('MOBILE_PIN_PEPPER already set - kept');
    expect(r.out).toContain('CONNECTION_SECRET_KEY already set - kept');
  });

  test('no legacy service_role key: refused, and nothing reaches Vercel', async () => {
    const r = await run({ keys: [{ name: 'default', api_key: PUBLISHABLE }, { name: 'default', api_key: SB_SECRET }] });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('No legacy service_role key');
    expect(r.calls.filter((c) => c.cli === 'vercel')).toEqual([]);
    expect(r.out).not.toContain(SB_SECRET);
  });

  test("a service_role key issued for another project is refused before Vercel", async () => {
    const r = await run({ keys: [{ name: 'anon', api_key: ANON }, { name: 'service_role', api_key: jwt({ ref: OTHER_REF, role: 'service_role' }) }] });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`issued for project ${OTHER_REF}, not ${REF}`);
    expect(r.calls.filter((c) => c.cli === 'vercel')).toEqual([]);
  });

  test('a login that cannot see the project stops before link, push or Vercel', async () => {
    const r = await run({ projects: [{ id: OTHER_REF, ref: OTHER_REF, name: 'KNICKGASM' }] });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`cannot see project ${REF}`);
    expect(supabaseCmds(r.calls)).toEqual(['projects list']);
    expect(r.calls.filter((c) => c.cli === 'vercel')).toEqual([]);
  });

  test('a refused access token is said, and nothing runs after it', async () => {
    const r = await run({ supabaseRefused: true });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('SUPABASE_ACCESS_TOKEN was refused');
    expect(supabaseCmds(r.calls)).toEqual(['projects list']);
  });

  test('a migration that fails stops the run: no auth push, no keys read, Vercel untouched', async () => {
    const r = await run({ pushFails: true });
    expect(r.status).not.toBe(0);
    expect(supabaseCmds(r.calls)).toEqual(['projects list', 'link --project-ref', 'db push --dry-run', 'db push']);
    expect(r.calls.filter((c) => c.cli === 'vercel')).toEqual([]);
  });

  test('a redeploy that never answers in Supabase mode fails the run with the last answer', async () => {
    const r = await run({ redeployDoesNotFlip: true }, { CONNECT_WAIT_SECONDS: '2' });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('did not answer in Supabase mode within 2 s; last answer: mode device (no_database_url)');
  });

  test('a checkout that is not origin/main pushes nothing: only main\'s proven schema goes out', async () => {
    const ws = workspace();
    fs.writeFileSync(path.join(ws.repo, 'supabase', 'migrations', '20260102000000_branch_only.sql'), 'select 2;\n');
    spawnSync('git', ['add', '-A'], { cwd: ws.repo, env: ws.env });
    spawnSync('git', ['commit', '-qm', 'branch only'], { cwd: ws.repo, env: ws.env });
    const log = path.join(ws.dir, 'calls.jsonl');
    fs.writeFileSync(log, '');
    const r = spawnSync('bash', [path.join(ws.repo, 'scripts', 'connect-supabase-project.sh')], {
      cwd: ws.repo, encoding: 'utf8',
      env: Object.assign({}, ws.env, { SUPABASE_BIN: path.join(ws.bin, 'supabase'), VERCEL_BIN: path.join(ws.bin, 'vercel'), FAKE_LOG: log, FAKE_SCENARIO: '/dev/null' }),
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('This checkout is not origin/main');
    expect(fs.readFileSync(log, 'utf8')).toBe('');
    expect(git(ws.repo, 'rev-parse', 'HEAD')).not.toBe(git(ws.repo, 'rev-parse', 'origin/main'));
  });
});
