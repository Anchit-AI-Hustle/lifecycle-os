// The cross-channel contact ledger and its fatigue rules, EXECUTED.
//
// The operator's rule: "if a user received an SMS at 10:00 AM, the Algorithmic
// Calendar must automatically suppress scheduled marketing emails or WhatsApp
// messages for 48 hours to prevent opt-out spikes."
//
// api/_shared/contact-fatigue.js (the one policy), contact-ledger.js (its
// storage), dispatch-core.js and preflight-core.js run UNMODIFIED against the
// in-memory PostgREST in tests/lib/fake-supabase.js, which enforces what
// 20261004093700_contact_ledger_fatigue.sql declares and nothing it does not:
// the dedupe index (a re-delivery is one touch), the CHECK constraints (a raw
// address in a hash column, an address or a number as a profile id, aborts the
// statement), the grant (a member's token cannot write a touch: 42501) and
// RLS (a stranger's token reads nothing). Klaviyo is answered only where a
// case routes it; any other outbound call throws.
//
// What has to hold:
//   - a promotional SMS at 10:00 is RECORDED when Klaviyo accepts it, and an
//     email to the same person (known by another identifier) at 11:00 is
//     BLOCKED by the 48 h cool-down with the time it clears; at +49 h it goes;
//   - three marketing touches across three channels in a rolling 7 days block
//     the fourth (absolute cap); the third promotional one needs an override,
//     which is recorded; a triggered lifecycle send is held to the absolute cap;
//   - transactional is never counted, never suppressed, never starts a cool-down;
//   - quiet hours in the recipient's region hold an SMS until morning there,
//     in every zone of a multi-zone region, and say so when the region is unknown;
//   - a calendar slot's eligibility is reduced by the ledger and says how many
//     and why; with no history it says "eligibility unknown — no send history";
//     with no database it says the ledger is unavailable, never 0 suppressed;
//   - nothing stored is an address or a number; the salt is per workspace;
//   - a brand's rules are its own, editable, and held to the spec;
//   - the gate reads no store on its own (its input can be a request body);
//     only a member's request reads the brand's ledger;
//   - the daily sync re-judges a stored slot when the ledger moves;
//   - (review) a person is found through the identifiers the ledger itself
//     links, to a stated limit that warns when hit; a request's carried
//     history only ADDS to a store, never replaces it; and the calendar
//     router reads a workspace's ledger only for a verified member of it.
//
// Run: npx playwright test tests/contact-fatigue-executed.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const { FakeSupabase, envScope, makeReq, makeRes, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');

const ROOT = path.resolve(__dirname, '..');
const fatigue = require(path.join(ROOT, 'api', '_shared', 'contact-fatigue.js'));
const ledger = require(path.join(ROOT, 'api', '_shared', 'contact-ledger.js'));
const dispatch = require(path.join(ROOT, 'api', '_shared', 'dispatch-core.js'));
const preflight = require(path.join(ROOT, 'api', '_shared', 'preflight-core.js'));
const connections = require(path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js'));
const cohorts = require(path.join(ROOT, 'api', '_shared', 'cohort-engine.js'));
const services = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
const lifecycleGen = require(path.join(ROOT, 'api', '_shared', 'lifecycle-calendar-generate.js'));
const SM = require(path.join(ROOT, 'api', '_shared', 'scenario-model.js'));

const ENV = envScope([
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'CONNECTION_SECRET_KEY', 'LIVE_CONNECTORS',
  'KLAVIYO_ALLOW_WRITES', 'KLAVIYO_REVISION', 'PUBLIC_BASE_URL', 'VERCEL_URL', 'CRON_SECRET', 'CONTACT_HASH_SALT',
]);
let REAL_FETCH;

test.beforeAll(() => {
  ENV.save();
  REAL_FETCH = global.fetch;
});
test.beforeEach(() => {
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CONNECTION_SECRET_KEY = 'c'.repeat(64);
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'LIVE_CONNECTORS', 'KLAVIYO_ALLOW_WRITES', 'KLAVIYO_REVISION', 'VERCEL_URL', 'PUBLIC_BASE_URL', 'CRON_SECRET', 'CONTACT_HASH_SALT']) delete process.env[k];
});
test.afterEach(() => { global.fetch = REAL_FETCH; });
test.afterAll(() => { ENV.restore(); global.fetch = REAL_FETCH; });

/* ── the world ──────────────────────────────────────────────────────────── */

const AUTH_A = { ok: true, token: 'tok-a', user_id: 'user-a', email: 'a@example.test' };
const AUTH_V = { ok: true, token: 'tok-v', user_id: 'user-v', email: 'v@example.test' };
const AUTH_B = { ok: true, token: 'tok-b', user_id: 'user-b', email: 'b@example.test' };
const DEVICE = { ok: true, token: 'D'.repeat(43), user_id: 'device:abc', provider: 'mobile-pin', mode: 'device' };

function world() {
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test').addUser('tok-v', 'user-v', 'v@example.test').addUser('tok-b', 'user-b', 'b@example.test')
    .addWorkspace('ws-a', 'user-a').addWorkspace('ws-b', 'user-b').addMember('ws-a', 'user-v', 'viewer')
    .setActive('user-a', 'ws-a').syncIdentityTables();
  const conn = db.insert('workspace_connections', {
    workspace_id: 'ws-a', provider: 'klaviyo', category: 'lifecycle', auth_kind: 'oauth', label: 'Klaviyo',
    config: { publishing_enabled: true }, secret_fields: ['access_token', 'refresh_token'], secret_hint: 'ss-1',
    status: 'active', connect_kind: 'oauth', oauth_scopes: ['templates:write', 'campaigns:write', 'events:write'],
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(), refresh_failure_count: 0, revoked_at: null,
  });
  db.insert('workspace_connection_secrets', Object.assign({ connection_id: conn.id, workspace_id: 'ws-a' }, connections.encryptSecrets({ access_token: 'kl-access-1', refresh_token: 'kl-refresh-1' })));
  db.install();
  connections._resolvedCache.clear();
  return db;
}
function live() { process.env.LIVE_CONNECTORS = 'on'; process.env.KLAVIYO_ALLOW_WRITES = '1'; }

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** Tomorrow 10:00 UTC: the moment the SMS lands. In the future, so a schedule is a schedule. */
const T0 = (() => { const d = new Date(Date.now() + DAY); d.setUTCHours(10, 0, 0, 0); return d.getTime(); })();
const iso = (ms) => new Date(ms).toISOString();

// A profile id is an ESP's own id, so it is namespaced by that ESP: the same
// id from two platforms is two people. The recipient names its provider.
const PERSON = { provider: 'klaviyo', external_profile_id: '01KPROFILEBUYER', email: 'Buyer@Example.test', phone: '+44 7700 900123', region: 'UK' };
const CLEAN_HTML = '<p>' + 'word '.repeat(120) + '</p><a href="https://brand.example.test/u">Unsubscribe</a>';

const SMS_SPEC = (extra) => Object.assign({
  channel: 'klaviyo_sms', skip_mapping: true, asset_ref: 'sms-drop-1', message_class: 'promotional', cohort_key: 'Champions',
  recipients: [PERSON],
  payload: { sms_body: 'The drop opens Friday. Text STOP to unsubscribe.', list_id: 'L1', send_at: iso(T0) },
}, extra || {});
const EMAIL_SPEC = (when, extra) => Object.assign({
  channel: 'klaviyo_email', skip_mapping: true, asset_ref: `mailer-${when}`, mode: 'schedule', scheduled_for: iso(when),
  message_class: 'promotional', recipients: [{ email: 'buyer@example.test' }],
  payload: { subject: 'The drop', html: CLEAN_HTML, from_email: 'hello@brand.example.test', list_id: 'L1', send_at: iso(when) },
}, extra || {});

const touches = (db) => db.table('contact_touch_ledger');
const checkOf = (pf, id) => (pf.checks || []).find((c) => c.id === id);

/** An ESP event for ingest, in the brand's own words. */
const EVENT = (id, channel, at, extra) => Object.assign({ event_id: id, channel, message_class: 'promotional', occurred_at: iso(at), provider: 'klaviyo', external_profile_id: '01KPROFILEBUYER' }, extra || {});

/* ── 1. the operator's rule, through the real dispatch queue ─────────────── */

test('an SMS at 10:00 is recorded when the platform accepts it, an email at 11:00 to the same person is blocked by the cool-down, and at +49 h it goes', async () => {
  const db = world();
  live();
  db.route((u) => u === 'https://a.klaviyo.com/api/campaigns/', () => ({ data: { id: 'camp-sms-1' } }));

  // A campaign is judged at the time it SENDS (its send_at), not at the time
  // it was queued: one scheduled for 21:30 UTC tomorrow (after 21:00 in
  // London, BST or GMT) is held for quiet hours whatever the time is now,
  // and the 10:00 one below is not, even when this runs at night.
  const night = await dispatch.enqueue(AUTH_A, 'ws-a', SMS_SPEC({ asset_ref: 'sms-night', payload: { sms_body: 'Late drop. Text STOP to unsubscribe.', list_id: 'L1', send_at: iso(T0 + 11.5 * HOUR) } }));
  expect(night).toMatchObject({ ok: false, blocked: true });
  expect(checkOf(night.preflight, 'contact_fatigue').fatigue).toMatchObject({ deferred: 1, by_reason: { quiet_hours: 1 } });

  // No history yet: unknown is a WARN with the sentence, never a pass.
  const sms = await dispatch.enqueue(AUTH_A, 'ws-a', SMS_SPEC());
  expect(sms.ok).toBe(true);
  const first = checkOf(sms.preflight, 'contact_fatigue');
  expect(first.status).toBe('warn');
  expect(first.detail).toMatch(/Eligibility unknown — no send history/);
  // The job carries the touch it will make: hashed recipients, never the address.
  const job = db.table('dispatch_jobs')[0];
  expect(job.contact_touch).toMatchObject({ channel: 'sms', message_class: 'promotional', cohort_key: 'Champions', recipients_known: true });
  expect(JSON.stringify(job.contact_touch)).not.toMatch(/buyer@|example\.test|7700|900123/i);

  const drained = await dispatch.drain({ workspaceId: 'ws-a', selfFire: false });
  expect(drained.results[0]).toMatchObject({ ok: true });
  expect(touches(db)).toHaveLength(1);
  const row = touches(db)[0];
  expect(row).toMatchObject({ workspace_id: 'ws-a', channel: 'sms', message_class: 'promotional', source: 'dispatch', source_ref: job.id, dispatch_job_id: job.id, cohort_key: 'Champions', region: 'UK', provider: 'klaviyo', external_profile_id: '01KPROFILEBUYER' });
  // Klaviyo SCHEDULED it for T0, so that is when it reaches the person.
  expect(row.occurred_at).toBe(iso(T0));
  expect(row.email_hash).toBe(fatigue.hashEmail('buyer@example.test', 'ws-a'));
  expect(row.phone_hash).toBe(fatigue.hashPhone('+447700900123', 'ws-a'));

  // 11:00 the same day: the person is known to the email only by address.
  const email1 = await dispatch.enqueue(AUTH_A, 'ws-a', EMAIL_SPEC(T0 + HOUR));
  expect(email1).toMatchObject({ ok: false, blocked: true });
  const blocked = checkOf(email1.preflight, 'contact_fatigue');
  expect(blocked.status).toBe('block');
  expect(blocked.detail).toMatch(/cross-channel cool-down/);
  expect(blocked.fatigue).toMatchObject({ status: 'computed', total: 1, eligible: 0, suppressed: 1, by_reason: { cooldown: 1 }, earliest_allowed_at: iso(T0 + 48 * HOUR) });
  expect(blocked.remediation).toMatch(/exclude the 1 held-back recipient/);
  expect(email1.preflight.blocking.join(' ')).toMatch(/Contact fatigue/);
  expect(db.table('dispatch_jobs'), 'a blocked send is not queued').toHaveLength(1);

  // The same email overridden: queued, and the audit names who and why.
  const forced = await dispatch.enqueue(AUTH_A, 'ws-a', EMAIL_SPEC(T0 + HOUR, { override_preflight: true, override_note: 'Order-status follow-up approved by CRM lead' }));
  expect(forced.ok).toBe(true);
  const audit = db.table('preflight_audits').find((a) => a.job_id === forced.job.id);
  expect(audit).toMatchObject({ verdict: 'block', overridden_by: 'user-a', override_note: 'Order-status follow-up approved by CRM lead' });
  expect(audit.checks.find((c) => c.id === 'contact_fatigue').status).toBe('block');

  // +49 h: the cool-down is over and one touch is inside every cap.
  const email2 = await dispatch.enqueue(AUTH_A, 'ws-a', EMAIL_SPEC(T0 + 49 * HOUR));
  expect(email2.ok).toBe(true);
  const clear = checkOf(email2.preflight, 'contact_fatigue');
  expect(clear.status).toBe('pass');
  expect(clear.fatigue).toMatchObject({ status: 'computed', eligible: 1, suppressed: 0 });
});

test('WhatsApp is held by the same cool-down, a later SMS too, and an email to someone else is not', () => {
  const ws = 'ws-a';
  const sms = { channel: 'sms', message_class: 'promotional', occurred_at: iso(T0), external_profile_id: 'P1', provider: 'klaviyo' };
  const at = (h, ch, who) => fatigue.evaluate({ workspaceId: ws, touches: [sms], candidates: [who || { external_profile_id: 'P1', provider: 'klaviyo' }], send: { channel: ch, message_class: 'promotional', at: iso(T0 + h * HOUR) } });
  expect(at(2, 'whatsapp')).toMatchObject({ suppressed: 1, by_reason: { cooldown: 1 } });
  expect(at(47.9, 'sms')).toMatchObject({ suppressed: 1, by_reason: { cooldown: 1 } });
  expect(at(48, 'email')).toMatchObject({ suppressed: 0, eligible: 1 });
  expect(at(1, 'push').suppressed, 'push is not in the cool-down').toBe(0);
  expect(at(1, 'email', { external_profile_id: 'P2', provider: 'klaviyo' }).suppressed, 'another person').toBe(0);
  // A cool-down cannot reach BACK: an email at 09:00, before the SMS, is not held by it.
  expect(at(-1, 'email').suppressed).toBe(0);
});

/* ── 2. caps across channels ────────────────────────────────────────────── */

test('three marketing touches across three channels in 7 days block the fourth; the third promotional one needs an override; triggered lifecycle is held to the absolute cap', async () => {
  const db = world();
  // Ingested ESP events, each in a different channel, none an SMS (no cool-down in play).
  const day = (n, h) => T0 - 7 * DAY + n * DAY + (h || 0) * HOUR;
  const r = await ledger.ingest(AUTH_A, 'ws-a', [
    EVENT('e-1', 'email', day(1)),
    EVENT('e-2', 'push', day(2)),
  ]);
  expect(r).toMatchObject({ recorded: 2, skipped: 0 });

  // Two promotional touches in the window: a third PROMOTIONAL send is over the
  // preferred cap, so it blocks until overridden...
  const third = await ledger.evaluateSend({ workspaceId: 'ws-a', channel: 'email', message_class: 'promotional', at: iso(day(4)), recipients: [PERSON] });
  expect(third).toMatchObject({ status: 'computed', suppressed: 1, by_reason: { promotional_cap: 1 } });
  expect(third.note).toMatch(/promotional cap \(2 per rolling 7 days\)/);
  // ...while a TRIGGERED lifecycle send (a cart abandon) is held to the absolute cap and goes.
  const trig = await ledger.evaluateSend({ workspaceId: 'ws-a', channel: 'email', message_class: 'triggered-lifecycle', at: iso(day(4)), recipients: [PERSON] });
  expect(trig).toMatchObject({ suppressed: 0, eligible: 1 });

  await ledger.ingest(AUTH_A, 'ws-a', [EVENT('e-3', 'in_app', day(3), { message_class: 'triggered-lifecycle' })]);
  for (const cls of ['promotional', 'triggered-lifecycle']) {
    const fourth = await ledger.evaluateSend({ workspaceId: 'ws-a', channel: 'email', message_class: cls, at: iso(day(5)), recipients: [PERSON] });
    expect(fourth, cls).toMatchObject({ status: 'computed', suppressed: 1, by_reason: { absolute_cap: 1 } });
    expect(fourth.note).toMatch(/absolute cap \(3 per rolling 7 days\)/);
  }
  // The window ROLLS: once the first touch is 7 days old, a triggered send fits again.
  const later = await ledger.evaluateSend({ workspaceId: 'ws-a', channel: 'email', message_class: 'triggered-lifecycle', at: iso(day(8, 1)), recipients: [PERSON] });
  expect(later.suppressed).toBe(0);

  // And through the gate, the fourth is a block.
  const pf = await dispatch.enqueue(AUTH_A, 'ws-a', EMAIL_SPEC(day(5), { recipients: [{ external_profile_id: '01KPROFILEBUYER', provider: 'klaviyo' }] }));
  expect(pf).toMatchObject({ ok: false, blocked: true });
  expect(checkOf(pf.preflight, 'contact_fatigue').fatigue.by_reason).toEqual({ absolute_cap: 1 });
});

/* ── 3. transactional ───────────────────────────────────────────────────── */

test('a transactional message is never blocked, never counted, and never starts a cool-down', async () => {
  const db = world();
  // Saturate the person: three marketing touches, a promotional SMS an hour ago.
  await ledger.ingest(AUTH_A, 'ws-a', [
    EVENT('m-1', 'email', T0 - 3 * DAY), EVENT('m-2', 'push', T0 - 2 * DAY), EVENT('m-3', 'sms', T0 - HOUR),
  ]);
  for (const ch of ['sms', 'email', 'whatsapp', 'push']) {
    // 23:00 in London: quiet hours too.
    const ev = await ledger.evaluateSend({ workspaceId: 'ws-a', channel: ch, message_class: 'transactional', at: iso(T0 + 12 * HOUR), recipients: [PERSON] });
    expect(ev, ch).toMatchObject({ status: 'exempt', suppressed: 0 });
  }
  const gate = await preflight.run({
    provider: 'klaviyo', channel: 'klaviyo_sms', mode: 'publish', message_class: 'transactional',
    connection: { oauth_scopes: ['campaigns:write'], config: { publishing_enabled: true }, secret_fields: ['access_token'], status: 'active' },
    payload: { sms_body: 'Your order has shipped. Text STOP to unsubscribe.', list_id: 'L1' }, mapping_missing: [],
    contact_fatigue: await ledger.evaluateSend({ workspaceId: 'ws-a', channel: 'sms', message_class: 'transactional', recipients: [PERSON] }),
  });
  expect(checkOf(gate, 'contact_fatigue')).toMatchObject({ status: 'pass' });
  expect(checkOf(gate, 'contact_fatigue').detail).toMatch(/never counted/);

  // Transactional touches do not count: one promotional + five transactional
  // leaves room for one more promotional send; a transactional SMS starts no cool-down.
  const ws = 'ws-x';
  const P = { external_profile_id: 'P9', provider: 'klaviyo' };
  const hist = [{ channel: 'email', message_class: 'promotional', occurred_at: iso(T0 - DAY), ...P }]
    .concat([1, 2, 3, 4, 5].map((i) => ({ channel: i === 5 ? 'sms' : 'email', message_class: 'transactional', occurred_at: iso(T0 - i * HOUR), ...P })));
  const ev = fatigue.evaluate({ workspaceId: ws, touches: hist, candidates: [P], send: { channel: 'email', message_class: 'promotional', at: iso(T0) } });
  expect(ev).toMatchObject({ status: 'computed', suppressed: 0, eligible: 1 });
  // The policy refuses to cap or cool-down transactional even when a brand asks.
  const n = fatigue.normaliseRules({ class_cap: { transactional: 'preferred' }, cooldowns: [{ after_channels: ['sms'], after_classes: ['transactional'], suppress_channels: ['email'], suppress_classes: ['transactional'], hours: 24 }] });
  expect(n.adjustments.map((a) => a.field)).toEqual(expect.arrayContaining(['class_cap.transactional', 'cooldowns[0].after_classes', 'cooldowns[0].suppress_classes']));
  expect(n.rules.class_cap.transactional).toBeUndefined();
});

/* ── 4. quiet hours ─────────────────────────────────────────────────────── */

test('quiet hours hold an SMS until morning in the recipient\'s own zone, in every zone of a multi-zone region, and say when the region is unknown', async () => {
  const ws = 'ws-q';
  // 22:30 in London on a BST date (UTC+1): 21:30 UTC.
  const londonNight = Date.UTC(2026, 9, 6, 21, 30);
  const uk = fatigue.evaluate({ workspaceId: ws, touches: [], candidates: [{ email: 'q@example.test', region: 'UK' }], send: { channel: 'sms', message_class: 'promotional', at: iso(londonNight) }, ledger: { available: true, workspace_touches: 4 } });
  expect(uk).toMatchObject({ status: 'computed', deferred: 1, suppressed: 0, eligible: 0, by_reason: { quiet_hours: 1 } });
  expect(uk.earliest_allowed_at).toBe('2026-10-07T07:00:00.000Z');          // 08:00 BST
  expect(uk.note).toMatch(/held by quiet hours/);

  // The US has four zones: 21:30 in New York is 18:30 in Los Angeles, and it
  // stays quiet until 08:00 in LOS ANGELES (15:00 UTC), the last zone to wake.
  const us = fatigue.evaluate({ workspaceId: ws, touches: [], candidates: [{ email: 'u@example.test', region: 'US' }], send: { channel: 'push', message_class: 'promotional', at: '2026-10-07T01:30:00Z' }, ledger: { available: true, workspace_touches: 4 } });
  expect(us).toMatchObject({ deferred: 1, earliest_allowed_at: '2026-10-07T15:00:00.000Z' });
  // An IANA zone on the recipient wins over the region.
  const tz = fatigue.evaluate({ workspaceId: ws, touches: [], candidates: [{ email: 'u@example.test', region: 'US', timezone: 'America/Los_Angeles' }], send: { channel: 'push', message_class: 'promotional', at: '2026-10-07T01:30:00Z' }, ledger: { available: true, workspace_touches: 4 } });
  expect(tz.deferred).toBe(0);

  // An email does not wake anyone, and a region nobody declared is not guessed.
  const email = fatigue.evaluate({ workspaceId: ws, touches: [], candidates: [{ email: 'q@example.test', region: 'UK' }], send: { channel: 'email', message_class: 'promotional', at: iso(londonNight) }, ledger: { available: true, workspace_touches: 4 } });
  expect(email.deferred).toBe(0);
  const unknown = fatigue.evaluate({ workspaceId: ws, touches: [], candidates: [{ email: 'q@example.test', region: 'FR' }], send: { channel: 'sms', message_class: 'promotional', at: iso(londonNight) }, ledger: { available: true, workspace_touches: 4 } });
  expect(unknown).toMatchObject({ deferred: 0, quiet_hours_unchecked: 1 });
  expect(unknown.note).toMatch(/could not be checked for 1: their region is not known/);

  // With NO history and NO database, quiet hours are still judged, and the gate holds the send.
  const gate = await preflight.run({
    provider: 'klaviyo', channel: 'klaviyo_sms', mode: 'schedule', scheduled_for: iso(londonNight), message_class: 'promotional',
    connection: { oauth_scopes: ['campaigns:write'], config: { publishing_enabled: true }, secret_fields: ['access_token'], status: 'active' },
    payload: { sms_body: 'Drop tonight. Text STOP to unsubscribe.', list_id: 'L1' }, mapping_missing: [],
    recipients: [{ email: 'q@example.test', region: 'UK' }],
  });
  const c = checkOf(gate, 'contact_fatigue');
  expect(c.status).toBe('block');
  expect(c.detail).toMatch(/Eligibility unknown/);
  expect(c.detail).toMatch(/held by quiet hours until 2026-10-07T07:00:00.000Z/);
  expect(c.remediation).toMatch(/Delay until 2026-10-07T07:00:00.000Z/);
});

/* ── 5. the calendar planners ───────────────────────────────────────────── */

function smartPlan(contactLedger, cohortList, days) {
  const cfg = services.smartConfig({ markets: ['UK'], calendarDays: days || 3, cohortsPerDay: 1 });
  return new services.CalendarIntelligenceService(cfg).generate({
    analysis: { cohorts: cohortList || [{ name: 'Champions', count: 5000 }], productScores: [{ product: { title: 'Hero', sku: 'SKU-1' }, score: 0.9 }], winningCampaigns: [], mvtLearnings: [], source: 'test' },
    competitorBenchmarks: { byChannel: {}, trendingHooks: [] },
    startDate: '2026-10-07', days: days || 3, contactLedger,
  });
}

test('a Smart Brain slot\'s eligibility is reduced by the ledger and says how many and why; planned recipients are the eligible ones', () => {
  const ws = 'ws-a';
  const A = { external_profile_id: 'PA', provider: 'klaviyo' };
  const B = { email: 'b@example.test' };
  const C = { phone: '+44 7700 900999' };
  const slotAt = Date.parse('2026-10-07T09:00:00Z');
  const ctx = {
    available: true, source: 'request', workspace_id: ws,
    touches: [
      // A had a promotional SMS yesterday at 10:00: inside the 48 h cool-down.
      { channel: 'sms', message_class: 'promotional', occurred_at: iso(slotAt - 23 * HOUR), ...A },
      // B had three marketing touches this week, on three channels.
      { channel: 'email', message_class: 'promotional', occurred_at: iso(slotAt - 5 * DAY), email_hash: fatigue.hashEmail('b@example.test', ws) },
      { channel: 'push', message_class: 'promotional', occurred_at: iso(slotAt - 4 * DAY), email_hash: fatigue.hashEmail('b@example.test', ws) },
      { channel: 'in_app', message_class: 'triggered-lifecycle', occurred_at: iso(slotAt - 3 * DAY), email_hash: fatigue.hashEmail('b@example.test', ws) },
    ],
    members: { Champions: [A, B, C] },
  };
  const plan = smartPlan(ctx);
  const e = plan.entries[0].reach.eligibility;
  expect(e).toMatchObject({ status: 'computed', basis: 'members', total: 3, eligible: 1, suppressed: 2, by_reason: { cooldown: 1, absolute_cap: 1 } });
  expect(e.note).toMatch(/2 of 3 recipient\(s\) held back: 1 over the absolute cap \(3 per rolling 7 days\); 1 by the cross-channel cool-down/);
  expect(e.time_basis).toMatch(/09:00 UTC/);
  expect(e.label).toBe('1 eligible · 2 held back');
  expect(plan.entries[0].reach.planned_recipients).toBe(1);
  // The plan's OWN earlier sends count: by the third daily slot to the same
  // cohort, the member the ledger left eligible has had two this week.
  const third = plan.entries[2].reach.eligibility;
  expect(third.eligible).toBe(0);
  expect(third.by_reason.promotional_cap + (third.by_reason.absolute_cap || 0) + (third.by_reason.cooldown || 0)).toBe(3);

  // No member list, a real cohort size: the ledger's people tagged with this
  // cohort are judged, the rest are judged on the plan's own sends.
  const tagged = Object.assign({}, ctx, { members: null, touches: ctx.touches.map((t) => Object.assign({ cohort_key: 'Champions' }, t)) });
  const p2 = smartPlan(tagged);
  expect(p2.entries[0].reach.eligibility).toMatchObject({ status: 'computed', basis: 'cohort-size-minus-ledger', total: 5000, eligible: 4998, suppressed: 2 });
  expect(p2.entries[0].reach.eligibility.note).toMatch(/2 of the 5000 were seen in the ledger/);
  expect(p2.entries[0].reach.planned_recipients).toBe(4998);
});

test('with no send history a slot says "eligibility unknown — no send history", with no database it says the ledger is unavailable, and neither invents a number', async () => {
  const db = world();
  // A real (empty) ledger for this workspace.
  const ctx = await ledger.contextFor({ workspaceId: 'ws-a' });
  expect(ctx).toMatchObject({ available: true, source: 'ledger', workspace_touches: 0 });
  const plan = smartPlan(ctx);
  for (const e of plan.entries) {
    expect(e.reach.eligibility).toMatchObject({ status: 'unknown', reason: 'no_history', eligible: null, suppressed: null });
    expect(e.reach.eligibility.label).toBe('Eligibility unknown — no send history');
    expect(e.reach.planned_recipients, 'the cohort size never stands in for eligible recipients').toBeNull();
    expect(e.feasibility.note).toMatch(/A ceiling, not a forecast/);
  }

  // The mailer calendar, for this workspace, reads the same empty ledger.
  const mc = await lifecycleGen.generateLifecycleCalendar({ start_date: '2026-10-07', days: 7, workspace_id: 'ws-a', cadence_per_week: 2 });
  expect(mc.plan.length).toBeGreaterThan(0);
  for (const r of mc.plan) expect(r.eligibility.label).toBe('Eligibility unknown — no send history');
  expect(mc.meta.frequency.ledger).toMatchObject({ available: true, workspace_touches: 0 });

  // Production's state: no database at all.
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const none = await ledger.contextFor({ workspaceId: null });
  expect(none).toMatchObject({ available: false, reason: 'no_database' });
  const p2 = smartPlan(none);
  const e = p2.entries[0].reach.eligibility;
  expect(e).toMatchObject({ status: 'unavailable', reason: 'no_database', eligible: null, suppressed: null });
  expect(e.note).toMatch(/contact ledger is unavailable \(this deployment has no workspace database configured/);
  expect(e.note).toMatch(/none is shown as zero/);
  expect(e.label).not.toMatch(/\b0\b/);
  const mc2 = await lifecycleGen.generateLifecycleCalendar({ start_date: '2026-10-07', days: 7 });
  expect(mc2.meta.frequency.ledger).toMatchObject({ available: false, reason: 'no_database' });
  expect(mc2.plan[0].eligibility.label).toBe('Eligibility unknown: contact ledger unavailable');
  expect(db.external(), 'nothing left for another host').toHaveLength(0);
});

test('the mailer calendar now has a cap: a 7-a-week cadence is BLOCKED after the third send to a cohort, and the ledger-tagged eligibility says what it knows', async () => {
  const db = world();
  // Two people of one cohort, seen in this brand's ledger.
  await ledger.ingest(AUTH_A, 'ws-a', [
    EVENT('t-1', 'sms', Date.parse('2026-10-06T12:00:00Z'), { cohort_key: 'tb_buyers_non_engagers', external_profile_id: 'TB1' }),
    EVENT('t-2', 'email', Date.parse('2026-10-03T12:00:00Z'), { cohort_key: 'tb_buyers_non_engagers', external_profile_id: 'TB2' }),
  ]);
  const out = await lifecycleGen.generateLifecycleCalendar({ start_date: '2026-10-07', days: 7, workspace_id: 'ws-a', cohorts: ['tb_buyers_non_engagers'], cadence_per_week: 7 });
  const caps = out.plan.map((r) => r.frequency_cap.status);
  expect(caps.slice(0, 4)).toEqual(['SAFE', 'SAFE', 'REDUCE_AUDIENCE', 'BLOCKED']);
  expect(out.plan[3].frequency_cap.action).toMatch(/NOT LAUNCH READY/);
  expect(out.meta.frequency.blocked).toBe(4);
  // 09:00 UTC on 10-07 is 21 h after TB1's SMS: TB1 is in the cool-down, TB2 is not.
  const first = out.plan[0].eligibility;
  expect(first).toMatchObject({ status: 'partial', basis: 'ledger-tagged', suppressed: 1, eligible: null, by_reason: { cooldown: 1 } });
  expect(first.note).toMatch(/the cohort's size is not known, so how many remain eligible is not stated/);
  expect(first.label).toBe('1 held back · eligible unknown');
});

/* ── 6. pseudonymous, per workspace ─────────────────────────────────────── */

test('no raw address or number is stored: the ledger and the job hold hashes, the store refuses PII, and a member cannot write a touch', async () => {
  const db = world();
  const raw = ['Buyer@Example.test', 'buyer@example.test', '+44 7700 900123', '447700900123', '7700 900123'];
  await ledger.ingest(AUTH_A, 'ws-a', [
    { event_id: 'p-1', channel: 'sms', message_class: 'promotional', occurred_at: iso(T0), phone: '+44 7700 900123', email: 'Buyer@Example.test' },
    // Some ESPs key a user by an address or a number: hashed as one, never kept as the id.
    { event_id: 'p-2', channel: 'email', message_class: 'promotional', occurred_at: iso(T0), user_id: 'buyer@example.test' },
    { event_id: 'p-3', channel: 'push', message_class: 'promotional', occurred_at: iso(T0), user_id: '447700900123' },
    { event_id: 'p-4', channel: 'push', message_class: 'promotional', occurred_at: iso(T0), user_id: '123456789012345678901' },
  ]);
  expect(touches(db)).toHaveLength(4);
  const dump = JSON.stringify(touches(db));
  for (const r of raw) expect(dump.toLowerCase(), r).not.toContain(r.toLowerCase());
  expect(touches(db)[1]).toMatchObject({ external_profile_id: null, email_hash: fatigue.hashEmail('buyer@example.test', 'ws-a') });
  expect(touches(db)[3].external_profile_id).toMatch(/^h:[0-9a-f]{64}$/);

  // The store itself refuses a raw address, even from the service role.
  const env = { method: 'POST', headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' } };
  const bad = await fetch(`${BASE}/rest/v1/contact_touch_ledger`, Object.assign({}, env, { body: JSON.stringify([{ workspace_id: 'ws-a', email_hash: 'buyer@example.test', channel: 'email', message_class: 'promotional', occurred_at: iso(T0), source: 'dispatch', source_ref: 'x', subject_key: 'f'.repeat(64) }]) }));
  expect(bad.status).toBe(400);
  expect(await bad.text()).toMatch(/contact_touch_email_hash_chk/);
  // A member's own token cannot write what reached a customer.
  const mine = await fetch(`${BASE}/rest/v1/contact_touch_ledger`, Object.assign({}, env, { headers: { apikey: ANON_KEY, authorization: 'Bearer tok-a', 'Content-Type': 'application/json' }, body: JSON.stringify([{ workspace_id: 'ws-a', external_profile_id: 'X', channel: 'email', message_class: 'promotional', occurred_at: iso(T0), source: 'dispatch', source_ref: 'y', subject_key: 'e'.repeat(64) }]) }));
  expect(mine.status).toBe(403);
  expect(touches(db)).toHaveLength(4);
  // ...and reads only its own brand's.
  const theirs = await fetch(`${BASE}/rest/v1/contact_touch_ledger?select=*`, { headers: { apikey: ANON_KEY, authorization: 'Bearer tok-b' } });
  expect(await theirs.json()).toEqual([]);

  // Re-delivery is ONE touch.
  const again = await ledger.ingest(AUTH_A, 'ws-a', [{ event_id: 'p-1', channel: 'sms', message_class: 'promotional', occurred_at: iso(T0), phone: '+44 7700 900123', email: 'Buyer@Example.test' }]);
  expect(again.recorded).toBe(1);
  expect(touches(db)).toHaveLength(4);
  // An event with no channel, class or id is not guessed.
  const unplaced = await ledger.ingest(AUTH_A, 'ws-a', [{ event_id: 'p-9', event_name: 'Something Happened', occurred_at: iso(T0), user_id: 'Z' }, { channel: 'email', message_class: 'promotional', occurred_at: iso(T0), user_id: 'Z' }]);
  expect(unplaced).toMatchObject({ recorded: 0, skipped: 2 });
  expect(unplaced.unplaced.map((u) => u.why).join(' | ')).toMatch(/not in this brand's event map.*no event_id/);
  // A viewer may not ingest.
  await expect(ledger.ingest(AUTH_V, 'ws-a', [EVENT('v-1', 'email', T0)])).rejects.toMatchObject({ status: 403 });
});

test('the contact hash is per workspace even when the deployment salt is set, and is unchanged when it is not', () => {
  const a0 = fatigue.hashEmail('person@example.com', 'workspace-a');
  // Byte-for-byte what cohort-engine produced before the salt moved here.
  expect(a0).toBe(require('crypto').createHash('sha256').update('workspace-a:person@example.com').digest('hex'));
  expect(cohorts.hashEmail('person@example.com', 'workspace-a')).toBe(a0);
  process.env.CONTACT_HASH_SALT = 'deployment-secret';
  const a = fatigue.hashEmail('person@example.com', 'workspace-a');
  const b = fatigue.hashEmail('person@example.com', 'workspace-b');
  // `CONTACT_HASH_SALT || workspaceId` made these EQUAL: one tenant could confirm another's list.
  expect(a).not.toBe(b);
  expect(a).not.toBe(a0);
  expect(fatigue.hashPhone('+44 7700 900123', 'workspace-a')).not.toBe(fatigue.hashPhone('+44 7700 900123', 'workspace-b'));
  expect(fatigue.hashPhone('0044 7700 900123', 'workspace-a')).toBe(fatigue.hashPhone('+447700900123', 'workspace-a'));
});

/* ── 7. a brand's own rules ─────────────────────────────────────────────── */

test('a brand edits its rules within the spec: an owner saves, a viewer cannot, a looser cap is refused with the reason, and the gate uses the saved rules', async () => {
  const db = world();
  // The defaults are stated.
  const def = await ledger.handle('rules', { auth: AUTH_A, workspaceId: 'ws-a', body: {} });
  expect(def.body).toMatchObject({ ok: true, source: 'default', storage: 'workspace' });
  expect(def.body.rules).toMatchObject({ promotional_per_7d: 2, absolute_per_7d: 3, cooldowns: [{ hours: 48, after_channels: ['sms', 'whatsapp'], suppress_channels: ['email', 'whatsapp', 'sms'] }], quiet_hours: { start: 21, end: 8 } });
  expect(def.body.describe.join(' ')).toMatch(/no promotional email, WhatsApp, SMS for 48 h/);
  expect(def.body.ledger).toMatchObject({ available: true, touches_in_window: 0 });

  const saved = await ledger.handle('rules-save', { auth: AUTH_A, workspaceId: 'ws-a', body: { rules: {
    promotional_per_7d: 5, absolute_per_7d: 3,
    cooldowns: [{ after_channels: ['sms', 'whatsapp'], suppress_channels: ['email', 'whatsapp', 'sms'], hours: 72 }],
  } } });
  expect(saved.body).toMatchObject({ ok: true, saved: true });
  expect(saved.body.rules.promotional_per_7d).toBe(2);
  expect(saved.body.adjustments[0]).toMatchObject({ field: 'promotional_per_7d', asked: 5, used: 2 });
  expect(saved.body.adjustments[0].why).toMatch(/never loosen|not a standing rule/);
  expect(db.table('contact_fatigue_rules')[0]).toMatchObject({ workspace_id: 'ws-a', updated_by: 'user-a' });
  await expect(ledger.handle('rules-save', { auth: AUTH_V, workspaceId: 'ws-a', body: { rules: {} } })).rejects.toMatchObject({ status: 403 });
  // A stranger naming this workspace reads nothing of it.
  const stranger = await ledger.handle('rules', { auth: AUTH_B, workspaceId: 'ws-a', body: {} });
  expect(stranger.status).toBe(404);
  const probe = await ledger.handle('evaluate', { auth: AUTH_B, workspaceId: 'ws-a', body: { channel: 'email', recipients: [PERSON] } });
  expect(probe.status).toBe(404);

  // The brand's 72 h cool-down: +49 h after the SMS is now still held.
  await ledger.ingest(AUTH_A, 'ws-a', [EVENT('r-1', 'sms', T0)]);
  const held = await ledger.evaluateSend({ workspaceId: 'ws-a', channel: 'email', message_class: 'promotional', at: iso(T0 + 49 * HOUR), recipients: [PERSON] });
  expect(held).toMatchObject({ suppressed: 1, by_reason: { cooldown: 1 }, earliest_allowed_at: iso(T0 + 72 * HOUR) });
  // A hand-written row cannot loosen a cap either: it is normalised on READ.
  db.table('contact_fatigue_rules')[0].rules = { absolute_per_7d: 9 };
  expect((await ledger.rulesFor({ workspaceId: 'ws-a' })).rules.absolute_per_7d).toBe(3);
});

test('a brand kept on a device: its rules are kept there and carried, the ledger is said to be unavailable, and the history a request carries is judged', async () => {
  // Production's state: no database.
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  global.fetch = () => { throw new Error('no network call is expected for a device brand'); };
  const rules = await ledger.handle('rules', { auth: DEVICE, workspaceId: null, body: {} });
  expect(rules.body).toMatchObject({ ok: true, storage: 'device', source: 'default' });
  expect(rules.body.ledger).toMatchObject({ available: false, reason: 'no_database' });
  expect(rules.body.ledger.note).toMatch(/no workspace database configured/);

  const saved = await ledger.handle('rules-save', { auth: DEVICE, workspaceId: null, body: { rules: { cooldowns: [{ after_channels: ['sms'], suppress_channels: ['email'], hours: 24 }] } } });
  expect(saved.body).toMatchObject({ ok: true, saved: false, storage: 'device' });
  expect(saved.body.note).toMatch(/Kept on this device beside the brand/);

  // The page carries what it kept; the server reads it for that request alone.
  const carriedPolicy = saved.body.rules;
  const history = { touches: [{ channel: 'sms', message_class: 'promotional', occurred_at: iso(T0), phone: '+44 7700 900123' }] };
  const ev = await ledger.handle('evaluate', { auth: DEVICE, workspaceId: null, body: {
    channel: 'email', message_class: 'promotional', at: iso(T0 + 25 * HOUR), recipients: [{ phone: '+447700900123' }],
    contact_ledger: history, contact_policy: carriedPolicy,
  } });
  expect(ev.body).toMatchObject({ ok: true, status: 'computed', suppressed: 0, ledger_source: 'request' });   // 24 h, the brand's own rule
  const ev2 = await ledger.handle('evaluate', { auth: DEVICE, workspaceId: null, body: {
    channel: 'email', message_class: 'promotional', at: iso(T0 + 23 * HOUR), recipients: [{ phone: '+447700900123' }],
    contact_ledger: history, contact_policy: carriedPolicy,
  } });
  expect(ev2.body).toMatchObject({ status: 'computed', suppressed: 1, by_reason: { cooldown: 1 } });
  // Nothing carried: unavailable, never zero.
  const ev3 = await ledger.handle('evaluate', { auth: DEVICE, workspaceId: null, body: { channel: 'email', recipients: [{ phone: '+447700900123' }] } });
  expect(ev3.body).toMatchObject({ status: 'unavailable', suppressed: null, eligible: null });
  const ing = await ledger.handle('ingest', { auth: DEVICE, workspaceId: null, body: { events: [] } });
  expect(ing.status).toBe(409);
  expect(ing.body.message).toMatch(/Nothing was recorded/);
});

/* ── 8. what the ledger does NOT record ─────────────────────────────────── */

test('a dry run, a campaign that was only created, and a trigger with no stated channel record nothing', async () => {
  const db = world();
  live();
  db.route((u) => u === 'https://a.klaviyo.com/api/campaigns/', () => ({ data: { id: 'camp-x' } }));
  db.route((u) => u === 'https://a.klaviyo.com/api/events/', () => ({}));
  // Created, not released (no send_at): nobody has been contacted yet. The
  // recipient names no region, so this is judged the same at any hour.
  const NOREGION = [{ provider: 'klaviyo', external_profile_id: '01KPROFILEBUYER', email: 'buyer@example.test' }];
  await dispatch.enqueue(AUTH_A, 'ws-a', SMS_SPEC({ asset_ref: 'sms-created', recipients: NOREGION, payload: { sms_body: 'Soon. Text STOP to unsubscribe.', list_id: 'L1' } }));
  // A dry run builds the request and does not send.
  await dispatch.enqueue(AUTH_A, 'ws-a', SMS_SPEC({ asset_ref: 'sms-dry', dry_run: true }));
  // A flow trigger whose message the platform decides.
  const ev = await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'klaviyo_event', skip_mapping: true, asset_ref: 'trig-1', payload: { metric: 'Viewed Drop', profile: { email: 'buyer@example.test' }, properties: {} } });
  expect(checkOf(ev.preflight, 'contact_fatigue')).toMatchObject({ status: 'skip' });
  expect(ev.preflight.verdict, 'a trigger is not warned for a rule that does not apply to it').toBe('pass');
  await dispatch.drain({ workspaceId: 'ws-a', selfFire: false });
  // The dry run ends `failed` (the adapter answers it as a validation stop), the other two `succeeded`.
  expect(db.table('dispatch_jobs').map((j) => j.status).sort()).toEqual(['failed', 'succeeded', 'succeeded']);
  expect(touches(db), 'nothing reached a person').toHaveLength(0);

  // The same trigger WITH a stated channel is a touch once accepted.
  await dispatch.enqueue(AUTH_A, 'ws-a', { channel: 'klaviyo_event', skip_mapping: true, asset_ref: 'trig-2', message_channel: 'whatsapp', message_class: 'triggered-lifecycle', payload: { metric: 'Cart Left', profile: { email: 'buyer@example.test' }, properties: {} } });
  await dispatch.drain({ workspaceId: 'ws-a', selfFire: false });
  expect(touches(db)).toHaveLength(1);
  expect(touches(db)[0]).toMatchObject({ channel: 'whatsapp', message_class: 'triggered-lifecycle', email_hash: fatigue.hashEmail('buyer@example.test', 'ws-a') });
});

/* ── 9. one policy, read everywhere ─────────────────────────────────────── */

test('every place a cap was computed reads the one policy: the cohort engine, the Smart Brain plan, the V1 segment ceiling', () => {
  expect(cohorts.FREQUENCY).toEqual({ promotional_per_7d: 2, absolute_per_7d: 3 });
  // A re-engagement BROADCAST is promotional: the preferred cap, not the absolute one.
  const rows = [{ external_profile_id: 'a', last_open_at: new Date().toISOString(), sends_7d: 2 }];
  expect(cohorts.frequencyCheck(cohorts.scoreContacts(rows).scored, { messagePriority: 're_engagement' })).toMatchObject({ cap: 2, over: 1 });
  expect(cohorts.frequencyCheck(cohorts.scoreContacts(rows).scored, { messagePriority: 'high_intent' })).toMatchObject({ cap: 3, over: 0 });
  // The `best` scenario multiplies cadence by 1.5: never above the absolute cap.
  expect(SM.DEFAULTS.SEGMENT_SEND_CEILING).toBe(3);
  expect(SM.scaleCadence({ Champions: 3 }, SM.SCENARIO_LEVERS.best).Champions).toBe(3);
  // A Smart Brain slot with NO discount still counts toward the cap (spec §10).
  const plan = smartPlan(null, [{ name: 'Nurture', count: 100 }], 5);
  expect(plan.entries.map((e) => e.reach.frequency_cap.status)).toEqual(['SAFE', 'SAFE', 'REDUCE_AUDIENCE', 'BLOCKED', 'BLOCKED']);
  expect(plan.entries.every((e) => e.message_class === 'promotional')).toBe(true);
});

/* ── 10. the gate reads no store on its own ─────────────────────────────── */

test('the gate on its own reads no ledger: a workspace named in its input is not read, and only a member gets the verdict over the brand\'s ledger', async () => {
  const db = world();
  await ledger.ingest(AUTH_A, 'ws-a', [EVENT('g-1', 'sms', T0)]);
  db.clearCalls();
  // What deliverability-preflight hands the gate is the request BODY with a
  // workspace id merged in - and a body can name any workspace. Reading the
  // ledger for it would answer "did that brand contact this address?".
  const pf = await preflight.run({
    workspaceId: 'ws-a', provider: 'klaviyo', channel: 'klaviyo_email', mode: 'publish', message_class: 'promotional', scheduled_for: iso(T0 + HOUR),
    connection: { oauth_scopes: ['campaigns:write', 'templates:write'], config: { publishing_enabled: true }, secret_fields: ['access_token'], status: 'active' },
    payload: { subject: 'x', html: CLEAN_HTML }, mapping_missing: [], recipients: [PERSON],
  });
  const c = checkOf(pf, 'contact_fatigue');
  expect(c.status).toBe('warn');
  expect(c.fatigue).toMatchObject({ status: 'unavailable', reason: 'not_supplied', suppressed: null });
  expect(c.detail).toMatch(/no contact ledger was supplied to this check/);
  expect(db.calls.filter((x) => /contact_touch_ledger|contact_fatigue_rules/.test(x.url)), 'the gate read the store').toEqual([]);

  // The router's door: membership first (RLS, as the caller), then the ledger.
  const mine = await ledger.evaluateForCaller(AUTH_A, 'ws-a', { channel: 'email', message_class: 'promotional', at: iso(T0 + HOUR), recipients: [PERSON] });
  expect(mine).toMatchObject({ status: 'computed', suppressed: 1, by_reason: { cooldown: 1 } });
  db.clearCalls();
  const theirs = await ledger.evaluateForCaller(AUTH_B, 'ws-a', { channel: 'email', message_class: 'promotional', at: iso(T0 + HOUR), recipients: [PERSON] });
  expect(theirs).toMatchObject({ status: 'unavailable', reason: 'not_supplied', suppressed: null });
  expect(db.calls.filter((x) => /contact_touch_ledger/.test(x.url))).toEqual([]);
});

/* ── 11. the daily sync keeps a stored slot honest ──────────────────────── */

test('the daily sync re-judges a stored slot when the ledger moves, says so in its change log, and keeps its prebuilt assets', async () => {
  const db = world();
  const plan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
  Object.assign(db.workspaces['ws-a'], {
    name: 'Fixture Brand', slug: 'fixture-brand',
    regions: [{ code: 'UK', name: 'United Kingdom', home: true }],
    offerings: [{ kind: 'product', name: 'Hero Tee', url: 'https://brand.example.test/p/hero' }],
  });
  db.syncIdentityTables();
  require(path.join(ROOT, 'api', '_shared', 'workspace-scope.js')).invalidate();
  // Outside the asset-refresh window, so only the contact state can move.
  const cfg = { workspace_id: 'ws-a', prebuildRefreshDays: 0 };
  const first = await plan.syncDaily({ config: cfg, days: 3 });
  expect(first.changes.map((c) => c.kind)).toEqual(['created', 'created', 'created']);
  const stored = () => db.table('smart_calendar_entries').slice().sort((a, b) => a.date.localeCompare(b.date));
  const slot = stored()[1];                                   // tomorrow
  expect(slot.payload.reach.eligibility.label).toBe('Eligibility unknown — no send history');
  expect(slot.payload.reach.frequency_cap.status).toBe('SAFE');
  slot.payload.__prebuilt = { campaign_id: 'camp-prebuilt-1', at: iso(Date.now()) };

  // A promotional SMS reaches one of this slot's cohort five hours before it.
  const at = Date.parse(`${slot.date}T09:00:00Z`) - 5 * HOUR;
  await ledger.ingest(AUTH_A, 'ws-a', [EVENT('s-1', 'sms', at, { cohort_key: slot.payload.cohort.name, external_profile_id: 'C1' })]);
  const second = await plan.syncDaily({ config: cfg, days: 3 });
  const change = second.changes.find((c) => c.id === slot.id);
  expect(change).toMatchObject({ kind: 'contact_rules' });
  expect(change.detail).toMatch(/Eligibility unknown — no send history → 1 held back · eligible unknown/);
  const after = stored()[1];
  expect(after.payload.reach.eligibility).toMatchObject({ status: 'partial', suppressed: 1, by_reason: { cooldown: 1 } });
  expect(after.payload.__prebuilt, 'the prebuilt assets are kept: only the contact fields moved').toMatchObject({ campaign_id: 'camp-prebuilt-1' });
  expect(after.change_log[after.change_log.length - 1]).toMatchObject({ kind: 'contact_rules' });
  // Nothing moved since: the third sync leaves the row alone.
  const third = await plan.syncDaily({ config: cfg, days: 3 });
  expect(third.changes.find((c) => c.id === slot.id)).toBeUndefined();
});

/* ── 12. review: three findings, each reproduced before it was fixed ────── */

const HASHED = (o) => Object.assign({ event_id: o.id, channel: o.channel, message_class: o.cls || 'promotional', occurred_at: iso(o.at) }, o.who);

test('a person is found through the identifiers the ledger links: an old row tying an address to a number lets a phone-only SMS hold the email, and a chain past the stated limit warns', async () => {
  const db = world();
  // Thirty days ago a receipt reached the address AND the number - the only
  // row that says they are one person (transactional, so it counts toward
  // nothing). Today at 10:00 a promotional SMS reached the NUMBER only.
  const put = await ledger.ingest(AUTH_A, 'ws-a', [
    HASHED({ id: 'bridge-1', channel: 'email', cls: 'transactional', at: T0 - 30 * DAY, who: { email: 'buyer@example.test', phone: '+44 7700 900123' } }),
    HASHED({ id: 'sms-phone-only', channel: 'sms', at: T0, who: { phone: '+44 7700 900123' } }),
  ]);
  expect(put.recorded).toBe(2);
  const ev = await ledger.evaluateSend({ workspaceId: 'ws-a', channel: 'email', message_class: 'promotional', at: iso(T0 + HOUR), recipients: [{ email: 'buyer@example.test' }] });
  expect(ev).toMatchObject({ status: 'computed', suppressed: 1, by_reason: { cooldown: 1 }, earliest_allowed_at: iso(T0 + 48 * HOUR) });
  expect(ev.links_incomplete).toBeFalsy();
  // The same through the shipped dispatch queue: blocked, not queued.
  const queued = await dispatch.enqueue(AUTH_A, 'ws-a', EMAIL_SPEC(T0 + HOUR));
  expect(queued).toMatchObject({ ok: false, blocked: true });
  expect(checkOf(queued.preflight, 'contact_fatigue').fatigue).toMatchObject({ suppressed: 1, by_reason: { cooldown: 1 } });

  // A chain of old rows, each tying one identifier to the next. Within the
  // stated limit (the recipient's own identifiers plus LINK_HOPS more) the SMS
  // at its far end is found; past it the verdict says the link was not
  // followed to its end, and the gate WARNS rather than passing a count it
  // knows is a lower bound.
  expect(ledger.LINK_HOPS).toBe(4);
  const chain = (tag, n) => {
    const ids = [];
    for (let i = 0; i <= n; i++) ids.push(i % 3 === 0 ? { email: `${tag}${i}@example.test` } : i % 3 === 1 ? { phone: `+44 7700 90${tag === 'near' ? 1 : 2}${String(i).padStart(3, '0')}` } : { provider: 'klaviyo', external_profile_id: `${tag.toUpperCase()}P${i}` });
    const rows = [];
    for (let i = 0; i < n; i++) rows.push(HASHED({ id: `${tag}-link-${i}`, channel: 'email', cls: 'transactional', at: T0 - (40 - i) * DAY, who: Object.assign({}, ids[i], ids[i + 1]) }));
    rows.push(HASHED({ id: `${tag}-sms`, channel: 'sms', at: T0, who: ids[n] }));
    return { first: ids[0], rows };
  };
  const near = chain('near', 4);     // the SMS is 4 links from the address
  const far = chain('far', 6);       // the SMS is 6 links from the address
  await ledger.ingest(AUTH_A, 'ws-a', near.rows.concat(far.rows));
  const atNear = await ledger.evaluateSend({ workspaceId: 'ws-a', channel: 'email', message_class: 'promotional', at: iso(T0 + HOUR), recipients: [near.first] });
  expect(atNear).toMatchObject({ status: 'computed', suppressed: 1, by_reason: { cooldown: 1 } });
  expect(atNear.links_incomplete).toBeFalsy();
  const atFar = await ledger.evaluateSend({ workspaceId: 'ws-a', channel: 'email', message_class: 'promotional', at: iso(T0 + HOUR), recipients: [far.first] });
  expect(atFar).toMatchObject({ status: 'computed', suppressed: 0, links_incomplete: true });
  expect(atFar.note).toMatch(/linked identifiers were followed 4 links from the recipients/i);
  expect(atFar.note).toMatch(/lower bound/);
  const gate = await dispatch.enqueue(AUTH_A, 'ws-a', EMAIL_SPEC(T0 + HOUR, { asset_ref: 'far-1', recipients: [far.first] }));
  const c = checkOf(gate.preflight, 'contact_fatigue');
  expect(c.status, 'a count the gate knows is a lower bound is not a pass').toBe('warn');
  expect(c.detail).toMatch(/followed 4 links/);
});

test('a request cannot erase the ledger: carried history only ADDS to the store - an empty one still meets the cool-down, a new carried touch holds, a carried copy of a stored touch counts once', async () => {
  const db = world();
  await ledger.ingest(AUTH_A, 'ws-a', [EVENT('sms-0', 'sms', T0, { email: 'buyer@example.test' })]);
  // An editor's dispatch that posts an EMPTY history with the email: the
  // stored SMS still holds it, through the shipped queue.
  const erased = await dispatch.enqueue(AUTH_A, 'ws-a', EMAIL_SPEC(T0 + HOUR, { contact_ledger: { touches: [] } }));
  expect(erased).toMatchObject({ ok: false, blocked: true });
  const c = checkOf(erased.preflight, 'contact_fatigue');
  expect(c.status).toBe('block');
  expect(c.fatigue).toMatchObject({ status: 'computed', suppressed: 1, by_reason: { cooldown: 1 } });
  expect(db.table('preflight_audits').some((a) => a.overridden_by), 'nothing was overridden').toBe(false);
  // The router's door says the same for a member.
  const viaRouter = await ledger.evaluateForCaller(AUTH_A, 'ws-a', { channel: 'email', message_class: 'promotional', at: iso(T0 + HOUR), recipients: [PERSON], carried: { touches: [] } });
  expect(viaRouter).toMatchObject({ status: 'computed', suppressed: 1, by_reason: { cooldown: 1 } });

  // A carried touch the store does not hold is ADDED: it can only hold more.
  const other = await dispatch.enqueue(AUTH_A, 'ws-a', EMAIL_SPEC(T0 + HOUR, {
    asset_ref: 'mailer-other', recipients: [{ email: 'other@example.test' }],
    contact_ledger: { touches: [{ channel: 'whatsapp', message_class: 'promotional', occurred_at: iso(T0), email: 'other@example.test' }] },
  }));
  expect(other).toMatchObject({ ok: false, blocked: true });
  expect(checkOf(other.preflight, 'contact_fatigue').fatigue).toMatchObject({ suppressed: 1, by_reason: { cooldown: 1 } });

  // A carried COPY of a stored touch is one touch: one stored promotional
  // email this week plus this one is two, inside the preferred cap; counted
  // twice it would be three and held.
  await ledger.ingest(AUTH_A, 'ws-a', [HASHED({ id: 'q-1', channel: 'email', at: T0 - 3 * DAY, who: { provider: 'klaviyo', external_profile_id: 'QQ1', email: 'q@example.test' } })]);
  const dup = await ledger.evaluateSend({
    workspaceId: 'ws-a', channel: 'email', message_class: 'promotional', at: iso(T0 + HOUR), recipients: [{ email: 'q@example.test' }],
    carried: { touches: [{ channel: 'email', message_class: 'promotional', occurred_at: iso(T0 - 3 * DAY), email: 'q@example.test' }] },
  });
  expect(dup).toMatchObject({ status: 'computed', suppressed: 0, eligible: 1, ledger_source: 'ledger+request' });
});

test('the calendar router reads a workspace\'s contact ledger only for a verified member of it: an anonymous browser request and another brand\'s member naming it get no ledger numbers, and no ledger query is made', async () => {
  const db = world();
  Object.assign(db.workspaces['ws-b'], {
    name: 'Other Brand', slug: 'other-brand', regions: [{ code: 'UK', name: 'United Kingdom', home: true }],
    offerings: [{ kind: 'product', name: 'Other Tee', url: 'https://other.example.test/p/tee' }],
  });
  db.syncIdentityTables();
  require(path.join(ROOT, 'api', '_shared', 'workspace-scope.js')).invalidate();
  const calendar = require(path.join(ROOT, 'api', 'calendar.js'));
  const call = async (action, { token = null, method = 'GET', body = null, query = {} } = {}) => {
    const req = makeReq({ token, method, body: body || {}, query: Object.assign({ action }, query), headers: { origin: 'https://app.example.test' } });
    const res = makeRes();
    await calendar(req, res);
    expect(res.code, JSON.stringify(res.payload).slice(0, 300)).toBe(200);
    return res.payload;
  };
  const LEDGER_FOR_B = (c) => /contact_touch_ledger|contact_fatigue_rules/.test(c.url) && /ws-b/.test(c.url);

  // The OWNER reads its own ledger: learn a slot's cohort and record a touch
  // for it, so a leak would show up as a number.
  const before = await call('smart-brain-plan', { token: 'tok-b', query: { workspace_id: 'ws-b' } });
  const slot = before.entries[1];
  expect(slot.reach.eligibility.label).toBe('Eligibility unknown — no send history');
  await ledger.ingest(AUTH_B, 'ws-b', [EVENT('b-sms-1', 'sms', Date.parse(`${slot.date}T09:00:00Z`) - 5 * HOUR, { cohort_key: slot.cohort.name, external_profile_id: 'B1' })]);
  const own = await call('smart-brain-plan', { token: 'tok-b', query: { workspace_id: 'ws-b' } });
  expect(own.entries.find((e) => e.id === slot.id).reach.eligibility).toMatchObject({ status: 'partial', suppressed: 1, by_reason: { cooldown: 1 } });

  const unchecked = (out) => {
    expect(out.entries.length).toBeGreaterThan(0);
    for (const e of out.entries) {
      const el = e.reach.eligibility;
      expect(el).toMatchObject({ status: 'unavailable', eligible: null, suppressed: null, deferred: null, by_reason: null });
      expect(el.reason).toMatch(/^(unverified|not_member)$/);
      expect(el.note).toMatch(/unchecked/);
      expect(el.label).toBe('Eligibility unchecked: contact ledger not read for this request');
      expect(e.reach.planned_recipients).toBeNull();
    }
  };
  // An anonymous BROWSER request naming ws-b, and a signed-in member of ws-a
  // naming ws-b: plan (GET) and the daily sync (POST, nothing persisted).
  for (const who of [{ token: null, reason: 'unverified' }, { token: 'tok-a', reason: 'not_member' }]) {
    db.clearCalls();
    const p = await call('smart-brain-plan', { token: who.token, query: { workspace_id: 'ws-b' } });
    unchecked(p);
    expect(p.entries[0].reach.eligibility.reason).toBe(who.reason);
    const s = await call('smart-brain-sync-daily', { token: who.token, method: 'POST', body: { workspace_id: 'ws-b', persist: false, prebuild: false, days: 3 } });
    unchecked({ entries: s.plan || s.entries || [] });
    expect(db.calls.filter(LEDGER_FOR_B), `${who.reason}: no ledger or rules query for ws-b`).toEqual([]);
  }
});
