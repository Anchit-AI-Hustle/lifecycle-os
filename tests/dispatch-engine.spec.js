// The publishing engine's invariants, pinned.
//
// This feature can spend a brand's ad budget and send mail to real people, so
// the things worth testing are not the happy paths - they are the refusals:
// what stops a double-post, what stops a send leaving before anyone said it
// could, and what stops "we could not check" being reported as "fine".
//
// Run: npx playwright test tests/dispatch-engine.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dispatch = require(path.join(ROOT, 'api', '_shared', 'dispatch-core.js'));
const base = require(path.join(ROOT, 'api', '_shared', 'adapters', 'base-adapter.js'));
const registry = require(path.join(ROOT, 'api', '_shared', 'adapters', 'registry.js'));
const preflight = require(path.join(ROOT, 'api', '_shared', 'preflight-core.js'));

/* ═══ idempotency ═════════════════════════════════════════════════════════ */

test('the same intent produces the same idempotency key, whatever the key order', () => {
  const a = dispatch.deriveIdempotencyKey({
    provider: 'klaviyo', channel: 'klaviyo_email', asset_ref: 'camp-1',
    payload: { subject: 'Hello', html: '<p>x</p>', list_id: 'L1' },
  });
  const b = dispatch.deriveIdempotencyKey({
    provider: 'klaviyo', channel: 'klaviyo_email', asset_ref: 'camp-1',
    // Same facts, different key order. A hash over JSON.stringify without a
    // stable sort would differ here, and every retry would create a new job.
    payload: { list_id: 'L1', html: '<p>x</p>', subject: 'Hello' },
  });
  expect(a).toBe(b);
});

test('editing the copy is a different intent, and is not deduplicated away', () => {
  const before = dispatch.deriveIdempotencyKey({ provider: 'klaviyo', channel: 'klaviyo_email', asset_ref: 'c', payload: { subject: 'A' } });
  const after = dispatch.deriveIdempotencyKey({ provider: 'klaviyo', channel: 'klaviyo_email', asset_ref: 'c', payload: { subject: 'B' } });
  expect(after).not.toBe(before);
});

test('a different channel is a different job even for the same asset', () => {
  const email = dispatch.deriveIdempotencyKey({ provider: 'klaviyo', channel: 'klaviyo_email', asset_ref: 'c', payload: {} });
  const sms = dispatch.deriveIdempotencyKey({ provider: 'klaviyo', channel: 'klaviyo_sms', asset_ref: 'c', payload: {} });
  expect(email).not.toBe(sms);
});

/* ═══ backoff ═════════════════════════════════════════════════════════════ */

test('backoff grows, stays under the ceiling, and is jittered', () => {
  const spread = new Set();
  for (let i = 0; i < 40; i += 1) spread.add(dispatch.backoffMs(3));
  // Without jitter every job that failed together retries in the same instant
  // and rebuilds the burst that caused the failure.
  expect(spread.size, 'backoff must be jittered, not a fixed curve').toBeGreaterThan(1);

  expect(dispatch.backoffMs(1)).toBeLessThan(dispatch.backoffMs(6) + 1);
  for (const attempt of [1, 5, 10, 40]) {
    expect(dispatch.backoffMs(attempt)).toBeLessThanOrEqual(dispatch.MAX_BACKOFF_MS);
    expect(dispatch.backoffMs(attempt)).toBeGreaterThan(0);
  }
});

test("a platform's own Retry-After outranks our arithmetic", () => {
  // Guessing shorter than a platform asked for is how a rate limit becomes a ban.
  expect(dispatch.backoffMs(1, 45000)).toBe(45000);
  expect(dispatch.backoffMs(9, 1000)).toBe(1000);
  // ...but never longer than the ceiling.
  expect(dispatch.backoffMs(1, 99 * 60 * 60 * 1000)).toBe(dispatch.MAX_BACKOFF_MS);
});

/* ═══ error classification ════════════════════════════════════════════════ */

test('failures are classified so the queue retries only what can succeed later', () => {
  expect(base.classifyStatus(429)).toBe('rate_limited');
  expect(base.classifyStatus(401)).toBe('auth');
  expect(base.classifyStatus(403)).toBe('auth');
  expect(base.classifyStatus(500)).toBe('transient');
  expect(base.classifyStatus(503)).toBe('transient');
  expect(base.classifyStatus(0)).toBe('transient');
  expect(base.classifyStatus(422)).toBe('permanent');

  // A throttle reported as a 400 with a code in the body - the same shape that
  // makes OpenAI's hard billing limit look like a validation error.
  expect(base.classifyStatus(400, { error: 'Rate limit exceeded' })).toBe('rate_limited');
  expect(base.classifyStatus(400, 'invalid parameter')).toBe('permanent');
});

test('Retry-After is read whether it is seconds or a date', () => {
  expect(base.retryAfterMs({ 'retry-after': '30' })).toBe(30000);
  const soon = new Date(Date.now() + 60000).toUTCString();
  expect(base.retryAfterMs({ 'retry-after': soon })).toBeGreaterThan(30000);
  expect(base.retryAfterMs({})).toBe(0);
});

/* ═══ the publish gate ════════════════════════════════════════════════════ */

test('nothing sends while the deployment kill switch is off', () => {
  const before = process.env.LIVE_CONNECTORS;
  delete process.env.LIVE_CONNECTORS;
  const gate = base.publishAllowance('https://graph.facebook.com/v25.0/x/media', { publishEnabled: true });
  expect(gate.allowed).toBe(false);
  expect(gate.reason).toBe('live_connectors_off');
  if (before !== undefined) process.env.LIVE_CONNECTORS = before;
});

test('a stored credential alone does not authorise sending as the brand', () => {
  const before = process.env.LIVE_CONNECTORS;
  process.env.LIVE_CONNECTORS = 'on';
  const gate = base.publishAllowance('https://graph.facebook.com/v25.0/x/media', { publishEnabled: false });
  expect(gate.allowed).toBe(false);
  expect(gate.reason).toBe('workspace_publishing_off');
  if (before === undefined) delete process.env.LIVE_CONNECTORS; else process.env.LIVE_CONNECTORS = before;
});

test('the standing read-only rule still covers Klaviyo, Shopify and WebEngage', () => {
  const before = { live: process.env.LIVE_CONNECTORS, allow: process.env.KLAVIYO_ALLOW_WRITES };
  process.env.LIVE_CONNECTORS = 'on';
  delete process.env.KLAVIYO_ALLOW_WRITES;

  // Both workspace-level switches are on, and the project-wide rule still holds.
  const gate = base.publishAllowance('https://a.klaviyo.com/api/campaigns/', { publishEnabled: true });
  expect(gate.allowed).toBe(false);
  expect(gate.reason).toBe('read_only_egress');
  expect(gate.blocker).toMatch(/KLAVIYO_ALLOW_WRITES/);

  // An unguarded host is unaffected by that rule.
  expect(base.publishAllowance('https://graph.facebook.com/v25.0/x', { publishEnabled: true }).allowed).toBe(true);

  if (before.live === undefined) delete process.env.LIVE_CONNECTORS; else process.env.LIVE_CONNECTORS = before.live;
  if (before.allow !== undefined) process.env.KLAVIYO_ALLOW_WRITES = before.allow;
});

test('a dry run reports the request it would have made, and sends nothing', async () => {
  const Meta = registry.adapterFor('meta');
  const adapter = new Meta({ workspaceId: 'w', credentials: { access_token: 't' }, dryRun: true });
  const out = await adapter.dispatch('facebook_page', { caption: 'hello', page_id: '123', image_url: 'https://cdn.example.com/a.jpg' });
  expect(out.ok).toBe(false);
  expect(out.sent).toBe(false);
  expect(out.would_request.method).toBe('POST');
  expect(out.would_request.url).toContain('graph.facebook.com');
});

/* ═══ secrets never ride along ════════════════════════════════════════════ */

test('a would_request body carries no credential', () => {
  const dirty = {
    access_token: 'SECRET-abc', refresh_token: 'SECRET-def', api_key: 'SECRET-ghi',
    client_secret: 'SECRET-jkl', developer_token: 'SECRET-mno',
    nested: { authorization: 'Bearer SECRET-pqr', caption: 'keep me' },
    list: [{ token: 'SECRET-stu' }],
  };
  const clean = JSON.stringify(base.redact(dirty));
  expect(clean, 'a redacted body must not contain any secret value').not.toMatch(/SECRET-/);
  expect(clean, 'non-secret content must survive redaction').toContain('keep me');
});

test('the Meta token never appears in a dry-run envelope', async () => {
  const Meta = registry.adapterFor('meta');
  const adapter = new Meta({ workspaceId: 'w', credentials: { access_token: 'TOKEN-should-not-leak' }, dryRun: true });
  const out = await adapter.dispatch('facebook_page', { caption: 'x', page_id: '1', image_url: 'https://e.example/a.jpg' });
  // The URL is a Graph API URL that legitimately carries the token as a query
  // parameter, which is exactly why the BODY is what gets stored and shown.
  expect(JSON.stringify(out.would_request.body || {})).not.toContain('TOKEN-should-not-leak');
});

/* ═══ preflight: unknown is never pass ════════════════════════════════════ */

test('a check that could not run warns; it never passes', async () => {
  const out = await preflight.run({
    provider: 'klaviyo',
    channel: 'klaviyo_email',
    mode: 'publish',
    connection: { oauth_scopes: ['campaigns:write', 'templates:write'], config: { publishing_enabled: true }, secret_fields: ['access_token'], status: 'active' },
    payload: { subject: 'Hi', html: '<p>hello there friend</p><a href="https://x.example/u">unsubscribe</a>' },
    mapping_missing: [],
    sending_domain: '',              // nothing to check
    // no contacts => segment health cannot be computed
  });
  const domain = out.checks.find((c) => c.id === 'domain_auth');
  const segment = out.checks.find((c) => c.id === 'segment_health');
  expect(domain.status).toBe('warn');
  expect(domain.detail).toMatch(/not a pass/i);
  expect(segment.status).toBe('warn');
  expect(out.verdict).not.toBe('pass');
});

test('a missing scope blocks before anything is sent', async () => {
  const out = await preflight.run({
    provider: 'klaviyo', channel: 'klaviyo_email', mode: 'publish',
    connection: { oauth_scopes: ['campaigns:read'], config: { publishing_enabled: true }, secret_fields: ['access_token'], status: 'active' },
    payload: { subject: 'x', html: '<p>y</p>unsubscribe' },
    mapping_missing: [],
  });
  expect(out.verdict).toBe('block');
  expect(out.blocking.join(' ')).toMatch(/campaigns:write/);
});

test('bulk promotional email with no unsubscribe is blocked, not warned', async () => {
  const out = await preflight.run({
    provider: 'klaviyo', channel: 'klaviyo_email', mode: 'publish',
    message_priority: 'promotional',
    connection: { oauth_scopes: ['campaigns:write', 'templates:write'], config: { publishing_enabled: true }, secret_fields: ['access_token'], status: 'active' },
    payload: { subject: 'Sale', html: '<p>' + 'word '.repeat(80) + '</p>' },
    mapping_missing: [],
  });
  const unsub = out.checks.find((c) => c.id === 'unsubscribe');
  expect(unsub.status).toBe('block');
  expect(out.verdict).toBe('block');
});

test('a revoked connection blocks with a reconnect instruction', async () => {
  const out = await preflight.run({
    provider: 'meta', channel: 'meta_ad', mode: 'publish',
    connection: { revoked_at: '2026-08-01T00:00:00Z', config: {}, secret_fields: [], status: 'active' },
    payload: { caption: 'x' }, mapping_missing: [],
  });
  expect(out.verdict).toBe('block');
  expect(out.blocking.join(' ')).toMatch(/revoked/i);
});

test('an unfilled required field blocks rather than sending a gap marker', async () => {
  const out = await preflight.run({
    provider: 'meta', channel: 'meta_ad', mode: 'publish',
    connection: { oauth_scopes: ['ads_management'], config: { publishing_enabled: true }, secret_fields: ['access_token'], status: 'active' },
    payload: {},
    mapping_missing: ['[DATA REQUIRED BEFORE LAUNCH: caption, Meta post]'],
  });
  expect(out.verdict).toBe('block');
  expect(out.blocking.join(' ')).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
});

/* ═══ the queue never exceeds the function cap ════════════════════════════ */

test('the whole feature added no serverless function', () => {
  const v = require(path.join(ROOT, 'vercel.json'));
  // The Hobby plan caps this at 12 and the deployment is at 12. Every module
  // this feature added lives under api/_shared/, which Vercel excludes.
  expect(Object.keys(v.functions).length).toBeLessThanOrEqual(12);
});
