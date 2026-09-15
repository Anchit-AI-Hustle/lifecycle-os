/**
 * Self-hosted Supabase: the kit is executable, and the app does not assume the
 * hosted service.
 * ---------------------------------------------------------------------------
 * WHY. Every one of the 77 PostgREST call sites, 195 RLS policies, 21 SQL
 * functions and 20 Storage references in this repo keeps working with zero
 * app changes only because SELF-HOSTED Supabase speaks the same protocol as
 * the hosted one. What could break that is (a) the kit itself — keys people
 * sign wrong, migrations applied in the wrong order, a compose file that
 * references a variable nobody defined — and (b) the app quietly dialling a
 * *.supabase.co host somewhere regardless of SUPABASE_URL. Both are tested
 * by EXECUTION here: the key generator's tokens are re-verified with Node
 * crypto in this file, the ordering function runs on the real directory,
 * the compose file is parsed (and, where Docker is present, cross-checked
 * against Docker Compose's own rendering), the bootstrap SQL is parsed for
 * guards, and auth.js is BOOTED in Chromium against https://db.example.org
 * with every request recorded.
 *
 * Run: npx playwright test tests/self-hosted-supabase.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const lib = require('../scripts/lib/selfhost-compose.js');
const keys = require('../scripts/selfhost-keys.js');
const buckets = require('../scripts/selfhost-buckets.js');

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* ═══ 1. the key generator ═══════════════════════════════════════════════ */

test('ANON_KEY and SERVICE_ROLE_KEY are HS256 JWTs with exactly the claims GoTrue/PostgREST read', () => {
  const set = keys.generate();
  expect(set.JWT_SECRET.length).toBeGreaterThanOrEqual(32);

  for (const [name, role] of [['ANON_KEY', 'anon'], ['SERVICE_ROLE_KEY', 'service_role']]) {
    const token = set[name];
    const [h, p, s] = token.split('.');
    // Decoded HERE, not through the module under test.
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    // Exact key set AND order — upstream's generate-keys.sh emits role, iss, iat, exp.
    expect(Object.keys(payload)).toEqual(['role', 'iss', 'iat', 'exp']);
    expect(payload.role, `${name} must SET ROLE ${role} in PostgREST`).toBe(role);
    expect(payload.iss).toBe('supabase');
    expect(payload.exp - payload.iat).toBe(5 * 365 * 24 * 3600);
    expect(Math.abs(payload.iat - Math.floor(Date.now() / 1000))).toBeLessThan(60);
    // Signature recomputed with Node crypto over the exact signing input.
    const expected = b64url(crypto.createHmac('sha256', set.JWT_SECRET).update(`${h}.${p}`).digest());
    expect(s, `${name} signature is not HMAC-SHA256(JWT_SECRET, header.payload)`).toBe(expected);
    expect(/=/.test(token), 'base64url must not be padded').toBe(false);
    expect(keys.verifyHS256(token, 'a-completely-different-secret-of-32-chars-plus')).toBe(false);
  }
  expect(set.REALTIME_DB_ENC_KEY).toHaveLength(16);
  expect(set.SECRET_KEY_BASE.length).toBeGreaterThanOrEqual(64);
  expect(set.POSTGRES_PASSWORD).toMatch(/^[0-9a-f]{32}$/);
});

test('the signing matches what the official stack accepts: upstream demo keys verify under the upstream demo secret', () => {
  // These two are copied from supabase/supabase docker/.env.example — the
  // keys the official compose has shipped and accepted for years. If our
  // HMAC/base64url differed from theirs in any byte, this would be false.
  const demoSecret = 'your-super-secret-jwt-token-with-at-least-32-characters-long';
  const demoAnon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE';
  const demoService = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q';
  expect(keys.verifyHS256(demoAnon, demoSecret)).toBe(true);
  expect(keys.verifyHS256(demoService, demoSecret)).toBe(true);
  expect(keys.decodeJwt(demoService).payload.role).toBe('service_role');
  // And ours, signed with THEIR secret, carries the same claim shape (modulo
  // the demo's pretty-printed payload, which is whitespace, not meaning).
  const ours = keys.apiKeys(demoSecret, { iat: 1641769200, exp: 1799535600 });
  const theirs = keys.decodeJwt(demoAnon).payload, mine = keys.decodeJwt(ours.ANON_KEY).payload;
  expect({ ...mine, iss: 'supabase-demo' }).toEqual(theirs);
});

test('--write fills only placeholders, keeps a filled secret, and never touches an external database password', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfhost-env-'));
  const envPath = path.join(dir, '.env');
  const first = keys.writeEnv(envPath, keys.generate());
  expect(fs.existsSync(envPath)).toBe(true);
  expect(first.written).toEqual(expect.arrayContaining(['JWT_SECRET', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'POSTGRES_PASSWORD', 'DASHBOARD_PASSWORD']));
  const after1 = lib.parseEnv(fs.readFileSync(envPath, 'utf8'));
  expect(keys.verifyHS256(after1.ANON_KEY, after1.JWT_SECRET)).toBe(true);
  // second run: nothing rotates by itself
  const second = keys.writeEnv(envPath, keys.generate());
  expect(second.written).toEqual([]);
  expect(lib.parseEnv(fs.readFileSync(envPath, 'utf8')).ANON_KEY).toBe(after1.ANON_KEY);
  // --rotate replaces; external mode still protects the managed password
  fs.writeFileSync(envPath, fs.readFileSync(envPath, 'utf8').replace(/^DB_MODE=.*$/m, 'DB_MODE=external').replace(/^POSTGRES_PASSWORD=.*$/m, 'POSTGRES_PASSWORD=neon-owner-password'));
  const third = keys.writeEnv(envPath, keys.generate(), { rotate: true });
  const after3 = lib.parseEnv(fs.readFileSync(envPath, 'utf8'));
  expect(after3.ANON_KEY).not.toBe(after1.ANON_KEY);
  expect(after3.POSTGRES_PASSWORD).toBe('neon-owner-password');
  expect(third.kept.some((k) => /POSTGRES_PASSWORD/.test(k))).toBe(true);
  // the anon key and the compose file agree on the secret name the services read
  expect(keys.verifyHS256(after3.SERVICE_ROLE_KEY, after3.JWT_SECRET)).toBe(true);
});

/* ═══ 2. migration order ═════════════════════════════════════════════════ */

test('the applier walks every migration file in TIMESTAMP order, executed on the real directory', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const order = lib.migrationOrder(dir);
  // complete: every .sql, nothing else (the README.md in that folder is skipped)
  expect(order.map((r) => r.file).slice().sort()).toEqual(onDisk);
  expect(order.length).toBeGreaterThan(50);
  // sorted by the 14-digit version, name within a version
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1], b = order[i];
    expect(a.version <= b.version, `${a.file} before ${b.file}`).toBe(true);
    if (a.version === b.version) expect(a.file < b.file).toBe(true);
    expect(b.version).toMatch(/^\d{14}$/);
  }
  // THE case that distinguishes timestamp order from name order: an 8-digit
  // prefix means midnight, so 20260719_… precedes 20260719120000_…, while a
  // plain sort puts it last because "_" > "1".
  const at = (f) => order.findIndex((r) => r.file === f);
  expect(at('20260719_ci_subscriptions.sql')).toBeLessThan(at('20260719120000_smart_generated_campaigns_rls.sql'));
  expect(onDisk.indexOf('20260719_ci_subscriptions.sql')).toBeGreaterThan(onDisk.indexOf('20260719140000_reconcile_generated_campaigns_payload.sql'));
  // the shell applier consumes the CLI, which must print the same list
  const cli = execFileSync('node', [path.join(ROOT, 'scripts', 'lib', 'selfhost-compose.js'), 'migrations'], { encoding: 'utf8' }).trim().split('\n');
  expect(cli).toEqual(order.map((r) => r.file));
});

test('selfhost-migrate.sh --list runs, and only external mode schedules the bootstrap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfhost-list-'));
  const example = fs.readFileSync(lib.PATHS.envExample, 'utf8');
  const run = (envText) => {
    const p = path.join(dir, '.env');
    fs.writeFileSync(p, envText);
    const r = spawnSync('bash', [path.join(ROOT, 'scripts', 'selfhost-migrate.sh'), '--list'], { encoding: 'utf8', env: { ...process.env, SELFHOST_ENV: p } });
    return { code: r.status, lines: r.stdout.trim().split('\n'), err: r.stderr };
  };
  const local = run(example);
  expect(local.code, local.err).toBe(0);
  expect(local.lines[0]).toBe('# mode: local');
  expect(local.lines.some((l) => l.includes('selfhost-bootstrap-db.sql'))).toBe(false);
  expect(local.lines.filter((l) => l.startsWith('supabase/migrations/')).length).toBe(lib.migrationOrder(lib.PATHS.migrations).length);
  expect(local.lines.some((l) => l.startsWith('supabase/seed/'))).toBe(true);

  const external = example
    .replace(/^DB_MODE=.*$/m, 'DB_MODE=external')
    .replace(/^POSTGRES_HOST=.*$/m, 'POSTGRES_HOST=ep-x.neon.tech')
    .replace(/^POSTGRES_SSLMODE=.*$/m, 'POSTGRES_SSLMODE=require')
    .replace(/^REALTIME_DB_SSL=.*$/m, 'REALTIME_DB_SSL=true')
    .replace(/^STORAGE_DB_INSTALL_ROLES=.*$/m, 'STORAGE_DB_INSTALL_ROLES=false');
  const ext = run(external);
  expect(ext.code, ext.err).toBe(0);
  expect(ext.lines[0]).toBe('# mode: external');
  expect(ext.lines[1]).toBe('scripts/selfhost-bootstrap-db.sql');
  expect(ext.lines[2]).toBe('supabase/migrations/' + lib.migrationOrder(lib.PATHS.migrations)[0].file);

  // an external .env that still points at the `db` container is refused
  const broken = run(example.replace(/^DB_MODE=.*$/m, 'DB_MODE=external'));
  expect(broken.code).not.toBe(0);
  expect(broken.err).toMatch(/POSTGRES_HOST/);
});

test('COMBINED_RUN_THIS.sql is not the migration set (so the applier must not use it)', () => {
  // Measured, not assumed: for each migration, do its first CREATE/ALTER/…
  // statements appear in the bundle? On 2026-09-15: 8 of 58. The applier
  // therefore uses the individual files; this pins that the bundle has not
  // quietly become complete (in which case this note should be revisited).
  const norm = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  const bundle = norm(fs.readFileSync(path.join(ROOT, 'supabase', 'COMBINED_RUN_THIS.sql'), 'utf8'));
  let represented = 0;
  const order = lib.migrationOrder(lib.PATHS.migrations);
  for (const r of order) {
    const stmts = norm(fs.readFileSync(path.join(lib.PATHS.migrations, r.file), 'utf8')).split(';').map((s) => s.trim())
      .filter((s) => /^(create|alter|insert|grant|revoke|do)/i.test(s)).slice(0, 4);
    if (stmts.length && stmts.every((s) => bundle.includes(s.slice(0, 120)))) represented++;
  }
  expect(represented, `bundle represents ${represented}/${order.length}`).toBeLessThan(order.length / 2);
});

/* ═══ 3. the compose file and .env ═══════════════════════════════════════ */

const composeDoc = () => lib.parseYaml(fs.readFileSync(lib.PATHS.compose, 'utf8'));
const exampleEnv = () => lib.loadKitEnv({ example: true });

test('docker-compose.yml parses and every ${VAR} it references is defined in .env.example', () => {
  const doc = composeDoc();
  expect(Object.keys(doc.services).sort()).toEqual(['auth', 'db', 'kong', 'meta', 'realtime', 'rest', 'storage', 'studio']);
  const env = exampleEnv();
  const refs = [...lib.collectRefs(doc).values()];
  expect(refs.length).toBeGreaterThan(40);
  const undefinedVars = refs.filter((r) => !(r.name in env)).map((r) => r.name);
  expect(undefinedVars, 'referenced in docker-compose.yml but absent from .env.example').toEqual([]);
  // the local db is behind a profile, and the services do not hard-require it
  expect(doc.services.db.profiles).toEqual(['local-db']);
  for (const s of ['auth', 'rest', 'realtime', 'storage', 'meta']) {
    expect(doc.services[s].depends_on.db.required, `${s} would refuse to start in external mode`).toBe('false');
  }
  // pinned images, never :latest
  for (const [name, svc] of Object.entries(doc.services)) {
    expect(svc.image, name).toMatch(/:[^:]+$/);
    expect(svc.image, name).not.toMatch(/:latest$/);
  }
  // the caddy override references only known variables too
  const caddy = lib.parseYaml(fs.readFileSync(path.join(lib.PATHS.kit, 'docker-compose.caddy.yml'), 'utf8'));
  for (const r of lib.collectRefs(caddy).values()) expect(r.name in env, r.name).toBe(true);
});

test('our compose parser agrees with Docker Compose itself (when docker is present)', () => {
  const probe = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  test.skip(probe.status !== 0, 'docker compose not available here');
  const r = spawnSync('docker', ['compose', '-f', lib.PATHS.compose, '--env-file', lib.PATHS.envExample, '--profile', 'local-db', 'config', '--format', 'json'], { encoding: 'utf8', cwd: lib.PATHS.kit });
  test.skip(r.status !== 0, 'docker compose config failed: ' + r.stderr.slice(0, 200));
  const theirs = JSON.parse(r.stdout);
  const mine = lib.render(composeDoc(), exampleEnv());
  expect(Object.keys(mine.services).sort()).toEqual(Object.keys(theirs.services).sort());
  for (const [name, svc] of Object.entries(mine.services)) {
    for (const [k, v] of Object.entries(svc.environment || {})) {
      expect(String(theirs.services[name].environment[k]), `${name}.${k}`).toBe(String(v));
    }
    expect(theirs.services[name].image).toBe(svc.image);
  }
});

test('external mode: every service dials POSTGRES_HOST with sslmode=require, and nothing still says `db`', () => {
  const doc = composeDoc();
  const env = {
    ...exampleEnv(),
    DB_MODE: 'external',
    POSTGRES_HOST: 'ep-cool-name-123456.eu-central-1.aws.neon.tech',
    POSTGRES_USER: 'neondb_owner',
    POSTGRES_SSLMODE: 'require',
    REALTIME_DB_SSL: 'true',
    AUTH_DB_USER: 'neondb_owner', STORAGE_DB_USER: 'neondb_owner', REALTIME_DB_USER: 'neondb_owner',
    META_DB_USER: 'neondb_owner', STUDIO_DB_USER: 'neondb_owner', STORAGE_DB_SUPER_USER: 'neondb_owner',
    STORAGE_DB_INSTALL_ROLES: 'false',
  };
  expect(lib.dbMode(env).problems).toEqual([]);
  const targets = lib.dbTargets(lib.render(doc, env));
  expect(targets.map((t) => t.service).sort()).toEqual(['auth', 'meta', 'realtime', 'rest', 'storage', 'studio']);
  for (const t of targets) {
    expect(t.host, `${t.service} host`).toBe(env.POSTGRES_HOST);
    expect(t.host, `${t.service} still dials the local container`).not.toBe('db');
    if (t.service !== 'studio') expect(t.secure, `${t.service} must require TLS on a managed Postgres`).toBe('require');
  }
  // URL-form services carry it literally in the connection string
  const rendered = lib.render(doc, env);
  expect(rendered.services.rest.environment.PGRST_DB_URI).toMatch(/\?sslmode=require$/);
  expect(rendered.services.auth.environment.GOTRUE_DB_DATABASE_URL).toMatch(/\?sslmode=require$/);
  expect(rendered.services.storage.environment.DATABASE_URL).toMatch(/\?sslmode=require$/);
  expect(rendered.services.meta.environment.PG_META_DB_SSL_MODE).toBe('require');
  expect(rendered.services.realtime.environment.DB_SSL).toBe('true');
  // the whole rendered document, not just the fields we thought to check
  const everyString = JSON.stringify(rendered.services);
  expect(everyString).not.toMatch(/@db:/);
  expect(everyString).not.toMatch(/sslmode=disable/);
  // storage-api's own role installer is off, so bootstrap owns the roles
  expect(rendered.services.storage.environment.DB_INSTALL_ROLES).toBe('false');

  // and local mode is the mirror image
  const local = lib.dbTargets(lib.render(doc, exampleEnv()));
  for (const t of local) expect(t.host, t.service).toBe('db');
  // an .env that claims external but still points at the container is refused
  expect(lib.dbMode({ ...exampleEnv(), DB_MODE: 'external' }).problems.join(' ')).toMatch(/POSTGRES_HOST/);
});

/* ═══ 4. the bootstrap SQL is idempotent ═════════════════════════════════ */

test('every CREATE in selfhost-bootstrap-db.sql is guarded, and the checker catches an unguarded one', () => {
  const bootstrap = fs.readFileSync(lib.PATHS.bootstrap, 'utf8');
  const report = lib.guardReport(bootstrap);
  expect(report.total, 'the checker inspected nothing').toBeGreaterThanOrEqual(12);
  expect(report.unguarded).toEqual([]);
  expect(report.guarded).toBe(report.total);
  // What the bootstrap must provide — by name, because the migrations use them.
  const stmts = lib.splitSql(bootstrap).map((s) => s.toLowerCase());
  for (const need of ['auth.uid()', 'auth.role()', 'auth.email()', 'auth.jwt()']) {
    expect(stmts.some((s) => s.includes('create or replace function ' + need)), need).toBe(true);
  }
  for (const role of ['anon', 'authenticated', 'service_role', 'authenticator']) {
    expect(bootstrap.toLowerCase().includes(`rolname = '${role}'`), `role ${role} guarded by pg_roles lookup`).toBe(true);
  }
  expect(bootstrap).toMatch(/create publication supabase_realtime/);
  expect(bootstrap).toMatch(/request\.jwt\.claims/);   // non-legacy PostgREST GUC — see the file
  // MUTATIONS: an unguarded top-level CREATE, and one hidden in a DO block
  const m1 = lib.guardReport(bootstrap + '\ncreate table selfhost.oops (id int);\n');
  expect(m1.unguarded.length).toBe(1);
  const m2 = lib.guardReport(bootstrap + "\ndo $$ begin create role oops nologin; end $$;\n");
  expect(m2.unguarded.length).toBe(1);
  const m3 = lib.guardReport(bootstrap + "\ndo $$ begin if not exists (select 1 from pg_roles where rolname='ok') then create role ok nologin; end if; end $$;\n");
  expect(m3.unguarded).toEqual([]);
  expect(m3.total).toBe(report.total + 1);
});

/* ═══ 5. buckets: idempotent through the Storage API ═════════════════════ */

test('selfhost-buckets.js creates what is missing and updates what exists, for all six app buckets', async () => {
  expect(buckets.BUCKETS.map((b) => b.id).sort()).toEqual(['brand-review-media', 'ci-captures', 'knowledge-base', 'mailer-assets', 'smart-brain-creatives', 'webengage-dumps']);
  const calls = [];
  const existing = new Set(['mailer-assets', 'knowledge-base']);
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', payload: opts.body ? JSON.parse(opts.body) : null });
    const id = url.split('/storage/v1/bucket/')[1];
    if (!opts.method && id) return { status: existing.has(id) ? 200 : 404, text: async () => '' };
    return { status: 200, text: async () => '' };
  };
  const out = await buckets.ensureBuckets({ base: 'https://db.example.org/', serviceKey: 'svc', fetchImpl, log: () => {} });
  expect(out.every((r) => r.ok)).toBe(true);
  expect(out.find((r) => r.id === 'mailer-assets').action).toBe('update');
  expect(out.find((r) => r.id === 'ci-captures').action).toBe('create');
  expect(calls.every((c) => c.url.startsWith('https://db.example.org/storage/v1/bucket'))).toBe(true);
  const created = calls.find((c) => c.method === 'POST' && c.payload.id === 'webengage-dumps');
  expect(created.payload.public).toBe(false);
  const updated = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/mailer-assets'));
  expect(updated.payload).toEqual({ public: true, file_size_limit: 10485760, allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] });
});

/* ═══ 6. THE APP DOES NOT ASSUME HOSTED SUPABASE ═════════════════════════ */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

/** Boot a page as a real host with SUPABASE_URL = `backend`, recording every request. */
async function boot(page, file, backend) {
  const requests = [];
  const errors = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.addInitScript(() => {
    window.__CREATE_CLIENT__ = [];
    window.supabase = {
      createClient: (url) => {
        window.__CREATE_CLIENT__.push(url);
        return {
          auth: {
            getSession: async () => ({ data: { session: null } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
            signInWithOAuth: async () => ({ error: null }),
            signOut: async () => ({}),
          },
        };
      },
    };
  });
  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/health/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
    return route.fulfill({
      status: 200, contentType: 'text/javascript',
      body: esm
        ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
        : 'window.tailwind=window.tailwind||{};',
    });
  });
  await page.route('http://app.example.test/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: null, workspaces: [] }) }));
  await page.route(/\/api\/public-config/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ supabase: { url: backend, anonKey: 'anon-key-for-test' } }),
  }));
  await page.goto('http://app.example.test/' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  return { requests, errors };
}

test('auth.js boots against a NON-.supabase.co SUPABASE_URL: the probe hits THAT host and nothing dials *.supabase.co', async ({ page }) => {
  const backend = 'https://db.example.org';
  const { requests, errors } = await boot(page, 'smart-brain.html', backend);
  // The config reached the page (otherwise the assertions below measure the no-config path).
  expect(await page.evaluate(() => (window.__SUPABASE__ || {}).url)).toBe(backend);
  // The reachability probe was sent to the configured host, derived from it.
  expect(requests, 'the /auth/v1/health probe did not go to the configured host').toContain(`${backend}/auth/v1/health`);
  // The client was constructed for that host.
  expect(await page.evaluate(() => window.__CREATE_CLIENT__)).toContain(backend);
  // THE ASSERTION THE HARDCODE SWEEP EXISTS FOR: no request, from any script
  // on the page, went to a hosted-Supabase host.
  const hosted = requests.filter((u) => { try { return /\.supabase\.(co|in|net)$/.test(new URL(u).hostname); } catch (_) { return false; } });
  expect(hosted, 'requests to a hosted Supabase host despite SUPABASE_URL pointing elsewhere').toEqual([]);
  // The page treated the self-hosted backend as reachable: signed-out notice, not an outage notice.
  const bar = page.locator('#lc-authnotice');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(/you are signed out/i);
  await expect(bar).not.toContainText(/cannot be reached|Running without a database/i);
  expect(errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e))).toEqual([]);
});

test('/api/public-config hands the browser the environment URL, never a pinned project', async () => {
  // The handler reads data/linked-db.json relative to process.cwd(), so a
  // temp working directory can PLANT a pinned project — the state the repo
  // was in until 2026-09-15 — and prove the env outranks it. (With the
  // shipped file, which is empty, a precedence regression would be invisible.)
  const handlerPath = path.join(ROOT, 'api', 'public-config.js');
  const planted = fs.mkdtempSync(path.join(os.tmpdir(), 'selfhost-pinned-'));
  fs.mkdirSync(path.join(planted, 'data'));
  fs.writeFileSync(path.join(planted, 'data', 'linked-db.json'), JSON.stringify({ url: 'https://pinnedprojectrefxxxxx.supabase.co', anonKey: 'pinned-anon' }));
  const saved = {};
  for (const k of Object.keys(process.env)) if (/^(SUPABASE_|NEXT_PUBLIC_)/.test(k)) { saved[k] = process.env[k]; delete process.env[k]; }
  const cwd = process.cwd();
  const call = async (workDir) => {
    delete require.cache[require.resolve(handlerPath)];
    const handler = require(handlerPath);
    const res = { statusCode: null, payload: null, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, removeHeader() {}, status(c) { this.statusCode = c; return this; }, json(o) { this.payload = o; return this; }, end() { return this; } };
    process.chdir(workDir);
    try { await handler({ method: 'GET', query: {}, headers: {}, url: '/api/public-config' }, res); }
    finally { process.chdir(cwd); }
    return res;
  };
  try {
    process.env.SUPABASE_URL = 'https://db.example.org';
    process.env.SUPABASE_ANON_KEY = 'anon-from-env';
    const withEnv = await call(planted);
    expect(withEnv.statusCode).toBe(200);
    // Before the fix this returned the pinned host: `ldb.url || process.env.SUPABASE_URL`.
    expect(withEnv.payload.supabase).toEqual({ url: 'https://db.example.org', anonKey: 'anon-from-env' });
    // No env at all: the file is the documented last resort, as a matched pair.
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY;
    const bare = await call(planted);
    expect(bare.payload.supabase).toEqual({ url: 'https://pinnedprojectrefxxxxx.supabase.co', anonKey: 'pinned-anon' });
    // And the file the repo actually SHIPS names nothing, so a fresh deployment
    // with no env reports "unconfigured" rather than dialling a dead project.
    const shipped = await call(ROOT);
    expect(shipped.payload.supabase.url).toBe('');
  } finally {
    process.chdir(cwd);
    for (const k of Object.keys(process.env)) if (/^(SUPABASE_|NEXT_PUBLIC_)/.test(k)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('no runtime file carries a hosted project ref', () => {
  // A claim about FILES, and a file check is the right tool: what ships in
  // the browser bundle or the serverless functions must not name a
  // *.supabase.co project. Docs, tests and management scripts for the hosted
  // platform (scripts/migrate-oauth.*) are out of scope by design.
  const runtime = ['auth.js', 'brand-context.js', 'sw.js', 'credits.js', 'brand-catalog.js', 'vercel.json', 'data/linked-db.json'];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of [...walk(path.join(ROOT, 'api')), ...walk(path.join(ROOT, 'lib'))]) if (/\.js$/.test(f)) runtime.push(path.relative(ROOT, f));
  const hits = [];
  for (const rel of runtime) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, 'utf8');
    for (const m of content.matchAll(/[a-z]{20}\.supabase\.co/g)) hits.push(`${rel}: ${m[0]}`);
  }
  expect(hits).toEqual([]);
  const pinned = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'linked-db.json'), 'utf8'));
  expect(pinned.url).toBe('');
  expect(pinned.project_ref).toBe('');
});
