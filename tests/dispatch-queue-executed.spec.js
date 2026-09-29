// The dispatch queue, EXECUTED: enqueue, lease, run, back off, drain, cancel,
// webhook ingest, and what a member may read back.
//
// api/_shared/dispatch-core.js runs unmodified. The store is the in-memory
// PostgREST in tests/lib/fake-supabase.js, which enforces the ONE thing the
// queue's correctness rests on - the unique index on (workspace_id,
// idempotency_key) - by answering a second insert with 23505 the way Postgres
// does. The platform (Klaviyo) is answered only where a case routes it; any
// other outbound call throws, so a send that escaped a gate fails loudly.
//
// What has to hold:
//
//   - the same intent twice is ONE job: the index refuses the second row and
//     enqueue answers `deduped` with the first job (the mutation that drops
//     the duplicate-key branch, or randomises the key, fails here);
//   - a claim is a conditional update: a leased job is not claimed by a second
//     worker until the lease lapses, and a finished job never;
//   - with the deployment kill switch off, the job builds the exact request,
//     is marked blocked, and NOTHING leaves; the workspace switch and the
//     read-only rule each refuse on their own;
//   - a 429 is retried when the platform said (Retry-After outranks our
//     arithmetic), a 503 backs off with jitter inside the documented bounds,
//     and attempts exhaust into `failed`;
//   - a token about to expire is refreshed before the send and the rotated
//     token is STORED before it is used; a refresh the platform refuses fails
//     the job for good and marks the connection;
//   - a platform token reaches the wire and never a stored row;
//   - ingestWebhook records a verified event and reconciles the job it names,
//     verifies nothing itself, and stores neither bytes nor headers;
//   - a member reads the queue without the raw payload, and never another
//     workspace's jobs.
//
// Run: npx playwright test tests/dispatch-queue-executed.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const { FakeSupabase, envScope, response, SERVICE_KEY, ANON_KEY, BASE, nowIso } = require('./lib/fake-supabase.js');

const ROOT = path.resolve(__dirname, '..');
const dispatch = require(path.join(ROOT, 'api', '_shared', 'dispatch-core.js'));
const connections = require(path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js'));
const KlaviyoAdapter = require(path.join(ROOT, 'api', '_shared', 'adapters', 'klaviyo-adapter.js'));

const EVENTS_URL = 'https://a.klaviyo.com/api/events/';
const TOKEN_URL = 'https://a.klaviyo.com/oauth/token';
const DRAIN_URL = 'https://app.example.test/api/brain?action=dispatch-drain&workspace_id=ws-a';
const CRON = 'cron-secret-for-tests';

const ENV = envScope([
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'CONNECTION_SECRET_KEY', 'LIVE_CONNECTORS',
  'KLAVIYO_ALLOW_WRITES', 'KLAVIYO_OAUTH_CLIENT_ID', 'KLAVIYO_OAUTH_CLIENT_SECRET', 'KLAVIYO_REVISION',
  'PUBLIC_BASE_URL', 'VERCEL_URL', 'CRON_SECRET', 'VERCEL_REGION',
]);
let REAL_FETCH;

test.beforeAll(() => {
  ENV.save();
  REAL_FETCH = global.fetch;
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CONNECTION_SECRET_KEY = 'c'.repeat(64);
  process.env.KLAVIYO_OAUTH_CLIENT_ID = 'kl-client';
  process.env.KLAVIYO_OAUTH_CLIENT_SECRET = 'kl-secret';
  process.env.PUBLIC_BASE_URL = 'https://app.example.test';
  process.env.CRON_SECRET = CRON;
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'LIVE_CONNECTORS', 'KLAVIYO_ALLOW_WRITES', 'KLAVIYO_REVISION', 'VERCEL_URL', 'VERCEL_REGION']) delete process.env[k];
});
test.afterAll(() => { ENV.restore(); global.fetch = REAL_FETCH; });
test.afterEach(() => {
  delete process.env.LIVE_CONNECTORS;
  delete process.env.KLAVIYO_ALLOW_WRITES;
  process.env.PUBLIC_BASE_URL = 'https://app.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
});

/* ── the world ──────────────────────────────────────────────────────────── */

const AUTH_A = { ok: true, token: 'tok-a', user_id: 'user-a', email: 'a@example.test' };
const AUTH_V = { ok: true, token: 'tok-v', user_id: 'user-v', email: 'v@example.test' };
const AUTH_B = { ok: true, token: 'tok-b', user_id: 'user-b', email: 'b@example.test' };

function connectKlaviyo(db, { expiresInMs = 3600_000, scopes, publishing = true, secrets } = {}) {
  const conn = db.insert('workspace_connections', {
    workspace_id: 'ws-a', provider: 'klaviyo', category: 'lifecycle', auth_kind: 'oauth', label: 'Klaviyo',
    config: { publishing_enabled: publishing }, secret_fields: ['access_token', 'refresh_token'], secret_hint: 'ss-1',
    status: 'active', connect_kind: 'oauth', oauth_scopes: scopes || ['templates:write', 'campaigns:write', 'events:write'],
    token_expires_at: new Date(Date.now() + expiresInMs).toISOString(), refresh_failure_count: 0, revoked_at: null,
  });
  const enc = connections.encryptSecrets(secrets || { access_token: 'kl-access-1', refresh_token: 'kl-refresh-1' });
  db.insert('workspace_connection_secrets', Object.assign({ connection_id: conn.id, workspace_id: 'ws-a' }, enc));
  return conn;
}

function world(opts = {}) {
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test').addUser('tok-v', 'user-v', 'v@example.test').addUser('tok-b', 'user-b', 'b@example.test')
    .addWorkspace('ws-a', 'user-a').addWorkspace('ws-b', 'user-b').addMember('ws-a', 'user-v', 'viewer')
    .setActive('user-a', 'ws-a').syncIdentityTables();
  if (opts.connect !== false) connectKlaviyo(db, opts);
  db.install();
  connections._resolvedCache.clear();
  return db;
}

/** All three switches on, so a send actually reaches the (routed) platform. */
function live() { process.env.LIVE_CONNECTORS = 'on'; process.env.KLAVIYO_ALLOW_WRITES = '1'; }

const EVENT_SPEC = (extra) => Object.assign({
  channel: 'klaviyo_event', skip_mapping: true, asset_ref: 'slot-1', asset_kind: 'event',
  payload: { metric: 'Placed Order', profile: { email: 'buyer@example.test' }, properties: { value: 10 }, token: 'sk-must-not-be-shown' },
}, extra || {});

const EMAIL_SPEC = (extra) => Object.assign({
  channel: 'klaviyo_email', skip_mapping: true, asset_ref: 'mailer-7', message_priority: 'promotional',
  payload: { subject: 'New drop', html: '<p>' + 'word '.repeat(60) + '</p>', from_email: 'hello@brand.example.test', list_id: 'L1' },
}, extra || {});

const jobs = (db) => db.table('dispatch_jobs');
const attempts = (db) => db.table('dispatch_attempts');
const audits = (db) => db.table('preflight_audits');

/* ── 1. enqueue ─────────────────────────────────────────────────────────── */

test('enqueue runs the preflight first and records the job with a redacted copy of the payload plus its audit', async () => {
  const db = world();
  const out = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC());
  expect(out.ok).toBe(true);
  expect(out.deduped).toBeUndefined();
  expect(out.preflight.verdict).toBe('pass');
  expect(out.preflight.checks.map((c) => c.id)).toEqual(expect.arrayContaining(['credential', 'publishing_enabled', 'scopes', 'mapping', 'content_spam']));

  const job = jobs(db)[0];
  expect(job).toMatchObject({ workspace_id: 'ws-a', provider: 'klaviyo', channel: 'klaviyo_event', status: 'queued', mode: 'publish', preflight_verdict: 'pass', created_by: 'user-a', max_attempts: 5, dry_run: false, asset_ref: 'slot-1', asset_kind: 'event' });
  expect(job.idempotency_key).toBe(dispatch.deriveIdempotencyKey({ provider: 'klaviyo', channel: 'klaviyo_event', asset_ref: 'slot-1', payload: EVENT_SPEC().payload }));
  expect(Date.parse(job.next_attempt_at)).toBeLessThanOrEqual(Date.now());
  expect(job.payload.token).toBe('sk-must-not-be-shown');          // the adapter needs the real thing
  expect(job.redacted_payload.token).toBe('[redacted]');           // a member sees this one
  expect(job.redacted_payload.metric).toBe('Placed Order');

  const audit = audits(db)[0];
  expect(audit).toMatchObject({ workspace_id: 'ws-a', job_id: job.id, provider: 'klaviyo', channel: 'klaviyo_event', verdict: 'pass', overridden_by: null, override_note: null });
  expect(Array.isArray(audit.checks)).toBe(true);
  expect(db.external(), 'enqueue sends nothing').toHaveLength(0);
});

test('the same intent twice is one job: the unique index refuses the second insert and enqueue answers deduped with the first', async () => {
  const db = world();
  const first = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC());
  const again = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC());
  expect(again.ok).toBe(true);
  expect(again.deduped).toBe(true);
  expect(again.job.id).toBe(first.job.id);
  expect(jobs(db), 'a second press of publish must not be a second row').toHaveLength(1);
  expect(audits(db)).toHaveLength(1);

  // Key order in the payload is not a different intent.
  const reordered = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ payload: { token: 'sk-must-not-be-shown', properties: { value: 10 }, profile: { email: 'buyer@example.test' }, metric: 'Placed Order' } }));
  expect(reordered.deduped).toBe(true);
  expect(jobs(db)).toHaveLength(1);

  // Edited copy IS a different intent, and a caller-supplied key is honoured.
  const edited = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ payload: Object.assign(EVENT_SPEC().payload, { properties: { value: 11 } }) }));
  expect(edited.deduped).toBeUndefined();
  expect(jobs(db)).toHaveLength(2);
  const named = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ idempotency_key: 'operator-key-1' }));
  expect(jobs(db)).toHaveLength(3);
  expect(named.job.idempotency_key).toBe('operator-key-1');
  expect((await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ idempotency_key: 'operator-key-1', asset_ref: 'other' }))).deduped).toBe(true);
  expect(jobs(db)).toHaveLength(3);

  // The same intent in ANOTHER workspace is that workspace's own job.
  connections._resolvedCache.clear();
  db.insert('workspace_connections', { workspace_id: 'ws-b', provider: 'klaviyo', config: { publishing_enabled: true }, secret_fields: ['api_key'], status: 'active', oauth_scopes: ['events:write'] });
  const theirs = await dispatch.enqueue(AUTH_B, 'ws-b', EVENT_SPEC());
  expect(theirs.deduped).toBeUndefined();
  expect(theirs.job.idempotency_key).toBe(first.job.idempotency_key);
  expect(jobs(db)).toHaveLength(4);
});

test('a blocked preflight never becomes a job; an operator override does, and the audit names who and why', async () => {
  const db = world();
  const refused = await dispatch.enqueue(AUTH_A, 'ws-a', EMAIL_SPEC());
  expect(refused).toMatchObject({ ok: false, blocked: true });
  expect(refused.message).toMatch(/unsubscribe/i);
  expect(refused.preflight.blocking.join(' ')).toMatch(/CAN-SPAM/);
  expect(jobs(db)).toHaveLength(0);
  expect(audits(db)).toHaveLength(0);

  const forced = await dispatch.enqueue(AUTH_A, 'ws-a', EMAIL_SPEC({ override_preflight: true, override_note: 'Transactional receipt: unsubscribe not required, legal ticket LG-42' }));
  expect(forced.ok).toBe(true);
  expect(forced.blocked).toBeUndefined();
  const job = jobs(db)[0];
  expect(job).toMatchObject({ status: 'queued', preflight_verdict: 'block' });
  const audit = audits(db)[0];
  expect(audit).toMatchObject({ job_id: job.id, verdict: 'block', overridden_by: 'user-a', override_note: 'Transactional receipt: unsubscribe not required, legal ticket LG-42' });
  expect(audit.blocking.join(' ')).toMatch(/Unsubscribe/);

  // An override with no note is still attributed, and carries the default wording rather than nothing.
  await dispatch.enqueue(AUTH_A, 'ws-a', EMAIL_SPEC({ override_preflight: true, asset_ref: 'mailer-8' }));
  expect(audits(db)[1]).toMatchObject({ overridden_by: 'user-a', override_note: 'Operator override.' });

  // A verdict that is not a block records no override even when the flag rides along.
  await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ override_preflight: true, override_note: 'unused' }));
  expect(audits(db)[2]).toMatchObject({ verdict: 'pass', overridden_by: null, override_note: null });
});

test('a draft is recorded and never runnable, a schedule needs a time, and only an editor may enqueue', async () => {
  const db = world();
  const draft = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ mode: 'draft' }));
  expect(draft.job.status).toBe('draft');

  await expect(dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ mode: 'schedule', asset_ref: 's2' }))).rejects.toMatchObject({ status: 400 });
  const when = new Date(Date.now() + 3600_000).toISOString();
  const sched = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ mode: 'schedule', scheduled_for: when, asset_ref: 's3', max_attempts: 99, dry_run: true }));
  expect(sched.job).toMatchObject({ status: 'queued', mode: 'schedule', scheduled_for: when, next_attempt_at: when, max_attempts: 10, dry_run: true });

  // Nothing above is runnable now: the draft by status, the schedule by time.
  expect(await dispatch.countRunnable('ws-a')).toBe(0);
  expect((await dispatch.drain({ workspaceId: 'ws-a', selfFire: false })).ran).toBe(0);
  expect(jobs(db).every((j) => j.lease_owner == null)).toBe(true);

  await expect(dispatch.enqueue(AUTH_V, 'ws-a', EVENT_SPEC())).rejects.toMatchObject({ status: 403 });
  await expect(dispatch.enqueue(AUTH_B, 'ws-a', EVENT_SPEC())).rejects.toMatchObject({ status: 404 });
  await expect(dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'no_such_channel' })).rejects.toMatchObject({ status: 400 });
  expect(jobs(db)).toHaveLength(2);

  // The adapter's own mapping runs when the caller does not skip it, and a
  // gap becomes a blocking marker rather than a placeholder.
  const gap = await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'klaviyo_email', asset: { subject: 'Hi' } });
  expect(gap.blocked).toBe(true);
  expect(gap.mapped.missing.join(' ')).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
});

/* ── 2. the lease ───────────────────────────────────────────────────────── */

test('a claim is a conditional update: a leased job cannot be claimed by a second worker until the lease lapses, and a finished job never', async () => {
  const db = world();
  const { job } = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC());

  const first = await dispatch.claim(job.id, 'worker-1');
  expect(first).toMatchObject({ id: job.id, lease_owner: 'worker-1', status: 'sending' });
  expect(Date.parse(first.lease_expires_at) - Date.now()).toBeGreaterThan(dispatch.LEASE_MS - 5000);

  expect(await dispatch.claim(job.id, 'worker-2'), 'a live lease must not be taken over').toBeNull();
  expect(jobs(db)[0].lease_owner).toBe('worker-1');

  // The worker died mid-send: once the lease lapses another may take the job.
  jobs(db)[0].lease_expires_at = new Date(Date.now() - 1000).toISOString();
  expect(await dispatch.claim(job.id, 'worker-2')).toMatchObject({ lease_owner: 'worker-2', status: 'sending' });

  jobs(db)[0].status = 'succeeded';
  jobs(db)[0].lease_owner = null;
  expect(await dispatch.claim(job.id, 'worker-3'), 'a finished job is never claimable').toBeNull();
  expect(await dispatch.claim('no-such-job', 'worker-3')).toBeNull();
});

/* ── 3. the three switches ──────────────────────────────────────────────── */

test('with the deployment kill switch off, a job builds the exact request, is marked blocked, and nothing leaves', async () => {
  const db = world();
  delete process.env.LIVE_CONNECTORS;
  const { job } = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC());
  const out = await dispatch.drain({ workspaceId: 'ws-a', selfFire: false });
  expect(out).toMatchObject({ ok: true, ran: 1, remaining: 0 });
  expect(out.results[0]).toMatchObject({ id: job.id, ok: false, terminal: true, error_class: 'blocked' });

  const row = jobs(db)[0];
  expect(row).toMatchObject({ status: 'blocked', lease_owner: null, lease_expires_at: null, attempt_count: 1 });
  expect(row.completed_at).toBeTruthy();
  expect(row.last_error).toMatch(/LIVE_CONNECTORS/);
  expect(row.result.would_request).toMatchObject({ method: 'POST', url: EVENTS_URL });
  expect(row.result.would_request.body.data.attributes.metric.data.attributes.name).toBe('Placed Order');
  expect(JSON.stringify(row.result)).not.toContain('kl-access-1');
  expect(db.external(), 'nothing may leave while the switch is off').toHaveLength(0);

  const attempt = attempts(db)[0];
  expect(attempt).toMatchObject({ job_id: job.id, workspace_id: 'ws-a', attempt_no: 1, ok: false, error_class: 'blocked', request_digest: 'POST a.klaviyo.com', backoff_ms: null });
  expect(db.table('platform_sync_log')[0]).toMatchObject({ workspace_id: 'ws-a', provider: 'klaviyo', direction: 'outbound', operation: 'dispatch:klaviyo_event', job_id: job.id, ok: false, records: 0 });
});

test('the workspace switch and the standing read-only rule each refuse on their own, and a refusal is not retried', async () => {
  // Deployment on, workspace off.
  let db = world({ publishing: false });
  process.env.LIVE_CONNECTORS = 'on';
  process.env.KLAVIYO_ALLOW_WRITES = '1';
  let out = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC());
  expect(out.preflight.checks.find((c) => c.id === 'publishing_enabled').status).toBe('warn');
  await dispatch.drain({ workspaceId: 'ws-a', selfFire: false });
  expect(jobs(db)[0].status).toBe('blocked');
  expect(jobs(db)[0].last_error).toMatch(/not enabled live publishing/);
  expect(db.external()).toHaveLength(0);

  // Both switches on, and Klaviyo is still fetch-only until the deployment says otherwise.
  db = world();
  delete process.env.KLAVIYO_ALLOW_WRITES;
  await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC());
  await dispatch.drain({ workspaceId: 'ws-a', selfFire: false });
  expect(jobs(db)[0].status).toBe('blocked');
  expect(jobs(db)[0].last_error).toMatch(/KLAVIYO_ALLOW_WRITES/);
  expect(db.external()).toHaveLength(0);
  expect(attempts(db)[0].error_class).toBe('blocked');

  // A dry run builds the request and reports it as validation, never as a send.
  db = world();
  live();
  await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ dry_run: true }));
  await dispatch.drain({ workspaceId: 'ws-a', selfFire: false });
  expect(jobs(db)[0].status).toBe('failed');
  expect(jobs(db)[0].result.would_request.url).toBe(EVENTS_URL);
  expect(jobs(db)[0].result.sent).toBe(false);
  expect(db.external()).toHaveLength(0);
});

/* ── 4. backoff ─────────────────────────────────────────────────────────── */

test("a 429 is retried when the platform said, a 503 backs off with jitter inside the bounds, and attempts exhaust into failed", async () => {
  const db = world();
  live();
  let answer = () => response(429, { errors: [{ detail: 'Too many requests' }] }, { 'retry-after': '45' });
  db.route((u) => u === EVENTS_URL, () => answer());
  const { job } = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC());

  const t0 = Date.now();
  let out = await dispatch.drain({ workspaceId: 'ws-a', selfFire: false });
  expect(out.results[0]).toMatchObject({ id: job.id, ok: false, terminal: false, error_class: 'rate_limited' });
  let row = jobs(db)[0];
  expect(row).toMatchObject({ status: 'queued', attempt_count: 1, lease_owner: null });
  const next = Date.parse(row.next_attempt_at) - t0;
  expect(next, 'the platform said 45s; ours would have been 15-30s').toBeGreaterThanOrEqual(44_000);
  expect(next).toBeLessThanOrEqual(47_000);
  expect(Date.parse(row.retry_after_at) - t0).toBeGreaterThanOrEqual(44_000);
  expect(attempts(db)[0]).toMatchObject({ attempt_no: 1, ok: false, error_class: 'rate_limited', backoff_ms: 45_000, request_digest: 'klaviyo:klaviyo_event' });

  // The call that went out carried the decrypted token; nothing stored does.
  const sent = db.external();
  expect(sent).toHaveLength(1);
  expect(sent[0].headers.authorization).toBe('Bearer kl-access-1');
  expect(sent[0].headers.revision).toBe('2024-10-15');
  expect(JSON.stringify([jobs(db), attempts(db), db.table('platform_sync_log')])).not.toContain('kl-access-1');

  // 503: our arithmetic, jittered inside [ceiling/2, ceiling] for attempt 2.
  answer = () => response(503, { message: 'try later' });
  row.next_attempt_at = new Date(Date.now() - 1).toISOString();     // the wait elapsed
  const t1 = Date.now();
  out = await dispatch.drain({ workspaceId: 'ws-a', selfFire: false });
  expect(out.results[0]).toMatchObject({ ok: false, terminal: false, error_class: 'transient' });
  row = jobs(db)[0];
  expect(row).toMatchObject({ status: 'queued', attempt_count: 2, retry_after_at: null });
  const ceiling = dispatch.BASE_BACKOFF_MS * 2;
  const wait = Date.parse(row.next_attempt_at) - t1;
  expect(wait).toBeGreaterThanOrEqual(ceiling / 2 - 1500);
  expect(wait).toBeLessThanOrEqual(ceiling + 1500);
  expect(attempts(db)[1].backoff_ms).toBeGreaterThanOrEqual(ceiling / 2);
  expect(attempts(db)[1].backoff_ms).toBeLessThanOrEqual(ceiling);

  // Exhaustion: the last permitted attempt fails for good.
  row.attempt_count = row.max_attempts - 1;
  row.next_attempt_at = new Date(Date.now() - 1).toISOString();
  out = await dispatch.drain({ workspaceId: 'ws-a', selfFire: false });
  expect(out.results[0]).toMatchObject({ ok: false, terminal: true, error_class: 'transient' });
  row = jobs(db)[0];
  expect(row).toMatchObject({ status: 'failed', attempt_count: 5 });
  expect(row.completed_at).toBeTruthy();
  expect(db.external()).toHaveLength(3);
  expect(await dispatch.countRunnable('ws-a')).toBe(0);
});

test('a rate limit stops the batch: the jobs behind it are left unclaimed for the next run', async () => {
  const db = world();
  live();
  db.route((u) => u === EVENTS_URL, () => response(429, {}, { 'retry-after': '30' }));
  const a = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ asset_ref: 'a' }));
  const b = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ asset_ref: 'b' }));
  const out = await dispatch.drain({ workspaceId: 'ws-a', selfFire: false });
  expect(out.ran).toBe(1);
  expect(out.results[0].id).toBe(a.job.id);
  const second = jobs(db).find((j) => j.id === b.job.id);
  expect(second).toMatchObject({ status: 'queued', attempt_count: 0, lease_owner: null });
  expect(out.remaining, 'the untouched job is still runnable').toBe(1);
  expect(db.external()).toHaveLength(1);
});

/* ── 5. success, and the token's whereabouts ────────────────────────────── */

test('a success records the platform id and the unverified-endpoint note, and never the raw response or the token', async () => {
  const db = world();
  live();
  db.route((u) => u === 'https://a.klaviyo.com/api/templates/', () => ({ data: { id: 'tpl-1' } }));
  db.route((u) => u === 'https://a.klaviyo.com/api/campaigns/', () => ({ data: { id: 'camp-1', attributes: { echo: 'raw-must-not-be-stored' } } }));
  const html = '<p>' + 'word '.repeat(120) + '</p><a href="https://brand.example.test/u">Unsubscribe</a>';
  const { job, preflight } = await dispatch.enqueue(AUTH_A, 'ws-a', EMAIL_SPEC({ payload: { subject: 'New drop', html, from_email: 'hello@brand.example.test', list_id: 'L1' } }));
  expect(preflight.verdict).toBe('warn');                            // no domain, no audience data: warned, not blocked

  const out = await dispatch.drain({ workspaceId: 'ws-a', selfFire: false });
  expect(out.results[0]).toMatchObject({ id: job.id, ok: true });
  const row = jobs(db)[0];
  expect(row).toMatchObject({ status: 'succeeded', external_id: 'camp-1', external_status: 'created', attempt_count: 1, last_error: null, lease_owner: null });
  expect(row.result.endpoint_unverified, 'the honesty surface must survive into the row').toBe(true);
  expect(row.result.note).toMatch(/NOT re-read from documentation/);
  expect(row.result.raw).toBeUndefined();
  expect(JSON.stringify([jobs(db), attempts(db), db.table('platform_sync_log')])).not.toContain('raw-must-not-be-stored');
  expect(JSON.stringify([jobs(db), attempts(db), db.table('platform_sync_log')])).not.toContain('kl-access-1');

  const calls = db.external();
  expect(calls.map((c) => c.url)).toEqual(['https://a.klaviyo.com/api/templates/', 'https://a.klaviyo.com/api/campaigns/']);
  expect(calls[1].headers.authorization).toBe('Bearer kl-access-1');
  expect(calls[1].body.data.attributes['campaign-messages'].data[0].attributes.content.subject).toBe('New drop');
  expect(attempts(db)[0]).toMatchObject({ ok: true, http_status: 200, request_digest: 'klaviyo:klaviyo_email' });
  expect(db.table('platform_sync_log')[0]).toMatchObject({ ok: true, records: 1, note: 'created', operation: 'dispatch:klaviyo_email' });

  // Done is done: nothing is left to drain, and the job cannot be claimed again.
  expect(await dispatch.countRunnable('ws-a')).toBe(0);
  expect(await dispatch.claim(job.id, 'w')).toBeNull();
});

test('a token about to expire is refreshed before the send, and the rotated token is stored BEFORE it is used', async () => {
  const db = world({ expiresInMs: 10_000 });                          // inside the 60s refresh skew
  live();
  db.route((u) => u === TOKEN_URL, (_u, init) => {
    expect(init.headers.Authorization).toBe('Basic ' + Buffer.from('kl-client:kl-secret').toString('base64'));
    const form = new URLSearchParams(String(init.body));
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('kl-refresh-1');
    return { access_token: 'kl-access-2', refresh_token: 'kl-refresh-2', expires_in: 600 };
  });
  db.route((u) => u === EVENTS_URL, () => ({ data: { id: 'evt' } }));
  await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC());
  const out = await dispatch.drain({ workspaceId: 'ws-a', selfFire: false });
  expect(out.results[0].ok).toBe(true);

  const urls = db.calls.map((c) => c.url);
  const refreshAt = urls.indexOf(TOKEN_URL);
  const storeAt = db.calls.findIndex((c, i) => i > refreshAt && c.url.includes('workspace_connection_secrets') && c.method === 'POST');
  const sendAt = urls.indexOf(EVENTS_URL);
  expect(refreshAt).toBeGreaterThan(-1);
  expect(storeAt, 'the rotated token is persisted').toBeGreaterThan(refreshAt);
  expect(sendAt, '...and only then used').toBeGreaterThan(storeAt);
  expect(db.calls[sendAt].headers.authorization).toBe('Bearer kl-access-2');

  const conn = db.table('workspace_connections')[0];
  expect(Date.parse(conn.token_expires_at) - Date.now()).toBeGreaterThan(500_000);
  expect(conn).toMatchObject({ refresh_failure_count: 0, revoked_at: null });
  const secrets = db.table('workspace_connection_secrets');
  expect(secrets).toHaveLength(1);
  expect(connections.decryptSecrets(secrets[0])).toEqual({ access_token: 'kl-access-2', refresh_token: 'kl-refresh-2' });
  expect(JSON.stringify(secrets)).not.toContain('kl-access-2');
  expect(JSON.stringify(secrets)).not.toContain('kl-refresh-2');
  expect(jobs(db)[0].status).toBe('succeeded');
});

test('a refresh the platform refuses fails the job for good and marks the connection; a refresh outage is retried; nothing connected is a reconnect', async () => {
  let db = world({ expiresInMs: 10_000 });
  live();
  db.route((u) => u === TOKEN_URL, () => response(400, { error: 'invalid_grant' }));
  await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC());
  let out = await dispatch.drain({ workspaceId: 'ws-a', selfFire: false });
  expect(out.results[0]).toMatchObject({ ok: false, terminal: true });
  expect(jobs(db)[0]).toMatchObject({ status: 'failed', attempt_count: 1 });
  expect(jobs(db)[0].last_error).toMatch(/reconnect/i);
  const conn = db.table('workspace_connections')[0];
  expect(conn).toMatchObject({ refresh_failure_count: 1, last_check_ok: false });
  expect(conn.revoked_at).toBeTruthy();
  expect(attempts(db)[0]).toMatchObject({ error_class: 'auth', backoff_ms: null });
  expect(db.external().some((c) => c.url === EVENTS_URL), 'nothing is sent on a dead credential').toBe(false);

  // A refresh OUTAGE is not a revocation: retried with backoff, connection intact.
  db = world({ expiresInMs: 10_000 });
  db.route((u) => u === TOKEN_URL, () => response(503, {}));
  await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC());
  out = await dispatch.drain({ workspaceId: 'ws-a', selfFire: false });
  expect(out.results[0]).toMatchObject({ ok: false, terminal: false });
  expect(jobs(db)[0]).toMatchObject({ status: 'queued', attempt_count: 1 });
  expect(Date.parse(jobs(db)[0].next_attempt_at)).toBeGreaterThan(Date.now() + 10_000);
  expect(db.table('workspace_connections')[0]).toMatchObject({ refresh_failure_count: 1, revoked_at: null });

  // Nothing connected at all: the job fails with a reconnect instruction, and no attempt is wasted on the platform.
  db = world({ connect: false });
  const orphan = db.insert('dispatch_jobs', { workspace_id: 'ws-a', idempotency_key: 'k', provider: 'klaviyo', channel: 'klaviyo_event', payload: EVENT_SPEC().payload, status: 'queued', attempt_count: 0, max_attempts: 5, next_attempt_at: nowIso() });
  out = await dispatch.runJob(orphan);
  expect(out).toMatchObject({ ok: false, terminal: true });
  expect(jobs(db)[0].status).toBe('failed');
  expect(jobs(db)[0].last_error).toMatch(/not connected/);
  expect(db.external()).toHaveLength(0);
});

/* ── 6. drain ───────────────────────────────────────────────────────────── */

test('drain claims serially, counts what is still runnable, and re-fires itself only when work remains', async () => {
  const db = world();
  live();
  const fired = [];
  db.route((u) => u.startsWith('https://app.example.test/api/brain'), (_u, _i, call) => { fired.push(call); return { ok: true }; });
  db.route((u) => u === EVENTS_URL, () => ({ data: { id: 'evt' } }));
  for (const ref of ['s1', 's2', 's3']) await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ asset_ref: ref }));

  let out = await dispatch.drain({ workspaceId: 'ws-a', limit: 2 });
  expect(out).toMatchObject({ ok: true, ran: 2, remaining: 1 });
  expect(fired).toHaveLength(1);
  expect(fired[0]).toMatchObject({ url: DRAIN_URL, method: 'POST' });
  expect(fired[0].headers.authorization).toBe(`Bearer ${CRON}`);
  expect(jobs(db).filter((j) => j.status === 'succeeded')).toHaveLength(2);

  out = await dispatch.drain({ workspaceId: 'ws-a', limit: 2 });
  expect(out).toMatchObject({ ran: 1, remaining: 0 });
  expect(fired, 'nothing left: no re-fire').toHaveLength(1);
  out = await dispatch.drain({ workspaceId: 'ws-a' });
  expect(out).toMatchObject({ ran: 0, remaining: 0 });
  expect(fired).toHaveLength(1);

  // The scheduler's whole-deployment drain has no workspace filter.
  await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ asset_ref: 's4' }));
  out = await dispatch.drain({});
  expect(out).toMatchObject({ ran: 1, remaining: 0 });
  expect(db.calls.find((c) => c.url.includes('dispatch_jobs') && c.url.includes('status=in.(queued,ready)') && !c.url.includes('workspace_id'))).toBeTruthy();

  // With no base URL there is nowhere to fire at, and that is silent.
  delete process.env.PUBLIC_BASE_URL;
  await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ asset_ref: 's5' }));
  await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ asset_ref: 's6' }));
  out = await dispatch.drain({ workspaceId: 'ws-a', limit: 1 });
  expect(out).toMatchObject({ ran: 1, remaining: 1 });
  expect(fired).toHaveLength(1);
});

/* ── 7. cancel ──────────────────────────────────────────────────────────── */

test('a queued job can be cancelled by an editor; a job already sending cannot be recalled; a viewer cannot cancel', async () => {
  const db = world();
  const queued = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ asset_ref: 'q' }));
  const sending = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC({ asset_ref: 's' }));
  await dispatch.claim(sending.job.id, 'worker-1');

  await expect(dispatch.cancel(AUTH_V, 'ws-a', queued.job.id)).rejects.toMatchObject({ status: 403 });
  expect(jobs(db).find((j) => j.id === queued.job.id).status).toBe('queued');

  expect(await dispatch.cancel(AUTH_A, 'ws-a', queued.job.id)).toEqual({ ok: true, cancelled: queued.job.id });
  const row = jobs(db).find((j) => j.id === queued.job.id);
  expect(row.status).toBe('cancelled');
  expect(row.completed_at).toBeTruthy();

  const refused = await dispatch.cancel(AUTH_A, 'ws-a', sending.job.id);
  expect(refused).toMatchObject({ ok: false, error: 'not_cancellable' });
  expect(refused.message).toMatch(/cannot be recalled/);
  expect(jobs(db).find((j) => j.id === sending.job.id).status).toBe('sending');

  // Another workspace's id names nothing here.
  await expect(dispatch.cancel(AUTH_B, 'ws-a', queued.job.id)).rejects.toMatchObject({ status: 404 });
  expect(await dispatch.countRunnable('ws-a')).toBe(0);
});

/* ── 8. webhooks ────────────────────────────────────────────────────────── */

test('ingestWebhook records the verified event and reconciles the job it names; it verifies nothing itself and stores neither bytes nor headers', async () => {
  const db = world();
  db.insert('dispatch_jobs', { workspace_id: 'ws-a', idempotency_key: 'k1', provider: 'klaviyo', channel: 'klaviyo_email', payload: {}, status: 'succeeded', external_id: 'camp-1', external_status: 'created', attempt_count: 1, max_attempts: 5, next_attempt_at: nowIso() });
  let verifyCalls = 0;
  const realVerify = KlaviyoAdapter.prototype.verifyWebhook;
  KlaviyoAdapter.prototype.verifyWebhook = function spied(...a) { verifyCalls += 1; return realVerify.apply(this, a); };
  try {
    const out = await dispatch.ingestWebhook('klaviyo', { id: 'camp-1', type: 'campaign.sent', status: 'sent' },
      { note: 'Signature verified over the raw request bytes (fixture).', bytes: Buffer.from('{"id":"camp-1"}'), headers: { 'x-signature': 'sig-abc' } });
    expect(out).toEqual({ stored: true, jobs_updated: 1 });
    const events = db.table('platform_webhook_events');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: 'klaviyo', event_type: 'campaign.sent', external_id: 'camp-1', verified: true, signature_note: 'Signature verified over the raw request bytes (fixture).' });
    expect(events[0].payload).toEqual({ id: 'camp-1', type: 'campaign.sent', status: 'sent' });
    expect(events[0].bytes).toBeUndefined();
    expect(events[0].headers).toBeUndefined();
    expect(JSON.stringify(events[0])).not.toContain('sig-abc');
    expect(jobs(db)[0].external_status).toBe('sent');
    expect(verifyCalls, 'trust was established by the receiver; ingest does not re-verify').toBe(0);
    expect(db.external()).toHaveLength(0);

    // A redelivery is one row (the dedupe index), still reconciled, with the default note.
    const again = await dispatch.ingestWebhook('klaviyo', { id: 'camp-1', type: 'campaign.sent', status: 'delivered' }, {});
    expect(again).toEqual({ stored: true, jobs_updated: 1 });
    expect(db.table('platform_webhook_events')).toHaveLength(1);
    expect(db.table('platform_webhook_events')[0].signature_note).toBe('Signature verified over the raw request bytes.');
    expect(jobs(db)[0].external_status).toBe('delivered');

    // Meta's envelope shape names the entry id; an event naming nothing reconciles nothing.
    expect(await dispatch.ingestWebhook('meta', { object: 'page', entry: [{ id: 'page-9', changes: [] }] }, { note: 'ok' })).toEqual({ stored: true, jobs_updated: 0 });
    expect(db.table('platform_webhook_events')[1]).toMatchObject({ provider: 'meta', event_type: 'page', external_id: 'page-9' });
    expect(await dispatch.ingestWebhook('meta', { object: 'page' }, {})).toEqual({ stored: true, jobs_updated: 0 });
    expect(db.table('platform_webhook_events')).toHaveLength(3);
    expect(jobs(db)[0].external_status).toBe('delivered');

    // A store outage is reported, not hidden, and reconciliation still happens.
    db.failures.platform_webhook_events = 500;
    expect(await dispatch.ingestWebhook('klaviyo', { id: 'camp-1', event_type: 'bounced' }, {})).toEqual({ stored: false, jobs_updated: 1 });
    expect(jobs(db)[0].external_status).toBe('bounced');
  } finally {
    KlaviyoAdapter.prototype.verifyWebhook = realVerify;
  }
});

/* ── 9. what a member reads ─────────────────────────────────────────────── */

test('members read the queue without the raw payload, and another workspace\'s jobs are invisible even when named', async () => {
  const db = world();
  const { job } = await dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC());

  const list = await dispatch.listJobs(AUTH_A, 'ws-a');
  expect(list).toHaveLength(1);
  expect(list[0].id).toBe(job.id);
  expect(list[0].payload).toBeUndefined();
  expect(list[0].redacted_payload.token).toBe('[redacted]');
  expect(await dispatch.listJobs(AUTH_A, 'ws-a', { status: 'succeeded' })).toEqual([]);
  expect(await dispatch.listJobs(AUTH_A, 'ws-a', { status: 'queued', limit: 1 })).toHaveLength(1);

  const detail = await dispatch.jobDetail(AUTH_A, 'ws-a', job.id);
  expect(detail.job.id).toBe(job.id);
  expect(detail.job.payload).toBeUndefined();
  expect(detail.job.redacted_payload.token).toBe('[redacted]');
  expect(detail.preflight).toMatchObject({ job_id: job.id, verdict: 'pass' });
  expect(detail.attempts).toEqual([]);

  expect(await dispatch.listJobs(AUTH_V, 'ws-a'), 'a viewer may read').toHaveLength(1);
  expect(await dispatch.listJobs(AUTH_B, 'ws-a'), 'a stranger sees nothing, even naming the workspace').toEqual([]);
  expect(await dispatch.jobDetail(AUTH_B, 'ws-a', job.id)).toBeNull();
  expect(await dispatch.jobDetail(AUTH_A, 'ws-a', 'no-such-job')).toBeNull();
  expect(JSON.stringify([list, detail])).not.toContain('sk-must-not-be-shown');
});

/* ── 10. the queue's own preconditions ──────────────────────────────────── */

test('a job for a provider with no adapter fails permanently; without the service key the queue refuses to run at all', async () => {
  const db = world();
  const job = db.insert('dispatch_jobs', { workspace_id: 'ws-a', idempotency_key: 'x', provider: 'no_such_platform', channel: 'x', payload: {}, status: 'queued', attempt_count: 0, max_attempts: 5, next_attempt_at: nowIso() });
  expect(await dispatch.runJob(job)).toMatchObject({ id: job.id, ok: false, terminal: true });
  expect(jobs(db)[0].status).toBe('failed');
  expect(jobs(db)[0].last_error).toMatch(/No adapter/);
  expect(attempts(db)[0].error_class).toBe('permanent');

  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  await expect(dispatch.drain({ workspaceId: 'ws-a' })).rejects.toMatchObject({ code: 'dispatch_store_unavailable', status: 503 });
  await expect(dispatch.enqueue(AUTH_A, 'ws-a', EVENT_SPEC())).rejects.toMatchObject({ status: 503 });
});
