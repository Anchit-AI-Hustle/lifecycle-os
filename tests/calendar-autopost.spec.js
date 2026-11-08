// Calendar autoposting on the brand's OWN linked accounts, EXECUTED (2026-11-08).
//
// The operator: "ensure that the complete flow for auto posting as per the
// calendar based on the platform also is integrated based on the user account
// linked to the respective social media platform."
//
// Driven through the SHIPPED code: calendar-autopost.scheduleSocialPost (what
// ?action=social-approve calls once a post is approved), dispatch-core's
// enqueue + drain (what the every-15-minutes scheduler calls), the real
// adapters, and the reconcile that writes the queue's outcome back onto the
// post - over the in-memory Supabase in tests/lib/fake-supabase.js and the
// fake platforms in tests/lib/fake-social-platforms.js, which answer only the
// documented endpoints and THROW on anything else.
//
// What has to hold, each asserted on what was sent or stored:
//   - approve -> one job per platform the post targets that THIS workspace
//     has connected; a platform not connected (or connected only on another
//     brand) is skipped with the Connect step in words; a platform with no
//     publishing channel is said;
//   - the job is scheduled for the post's own day at the platform's hour in
//     the brand's home time zone, and a drain before that time sends nothing;
//   - at the due time the adapter reaches the platform with the WORKSPACE'S
//     own token, and the post reads posted;
//   - with a switch off the job is withheld with the exact request and the
//     platform is not called;
//   - approving again, and draining again, never posts twice.
//
// Run: npx playwright test tests/calendar-autopost.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const dns = require('dns');
const { FakeSupabase, envScope, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');
const { installPlatforms, MEDIA } = require('./lib/fake-social-platforms.js');

const ROOT = path.resolve(__dirname, '..');
const connections = require(path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js'));
const dispatch = require(path.join(ROOT, 'api', '_shared', 'dispatch-core.js'));
const autopost = require(path.join(ROOT, 'api', '_shared', 'calendar-autopost.js'));

const SWITCHES = ['META_ALLOW_WRITES', 'TIKTOK_ALLOW_WRITES', 'PINTEREST_ALLOW_WRITES', 'YOUTUBE_ALLOW_WRITES', 'GOOGLE_ADS_ALLOW_WRITES'];
const ENV = envScope([
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'CONNECTION_SECRET_KEY', 'PUBLIC_BASE_URL', 'VERCEL_URL',
  'LIVE_CONNECTORS', 'CRON_SECRET', 'VERCEL_REGION', ...SWITCHES,
]);
let REAL_FETCH; let REAL_LOOKUP; const REAL_DATE = Date;

function baseEnv() {
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CONNECTION_SECRET_KEY = 'e'.repeat(64);
  process.env.PUBLIC_BASE_URL = 'https://app.example.test';
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'VERCEL_URL', 'VERCEL_REGION', 'CRON_SECRET', 'LIVE_CONNECTORS', ...SWITCHES]) delete process.env[k];
}

/** Move the clock (Date and Date.now) forward, as the scheduler's next run would find it. */
function shiftClock(ms) {
  const Real = REAL_DATE;
  global.Date = class extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + ms); }
    static now() { return Real.now() + ms; }
  };
}

test.beforeAll(() => {
  ENV.save();
  REAL_FETCH = global.fetch;
  REAL_LOOKUP = dns.promises.lookup;
  dns.promises.lookup = async (host) => {
    if (host === 'cdn.brand.example') return [{ address: '93.184.216.34', family: 4 }];
    const e = new Error(`getaddrinfo ENOTFOUND ${host}`); e.code = 'ENOTFOUND'; throw e;
  };
  baseEnv();
});
test.afterAll(() => { ENV.restore(); global.fetch = REAL_FETCH; dns.promises.lookup = REAL_LOOKUP; global.Date = REAL_DATE; });
test.afterEach(() => { global.Date = REAL_DATE; baseEnv(); });

const AUTH_A = { ok: true, token: 'tok-a', user_id: 'user-a', email: 'a@example.test' };
const DAY = 86400000;
const CATEGORY = { meta_ads: 'ads', tiktok: 'social', pinterest: 'social', youtube: 'social' };
// The brand as the router resolves it: home market IN, its own time zone on the record.
const BRAND = { id: 'ws-a', name: 'Brand A', website: 'https://brand.example', regions: [{ code: 'IN', home: true, currency: 'INR', timezone: 'Asia/Kolkata', store_url: 'https://brand.example' }] };

function world() {
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test').addUser('tok-b', 'user-b', 'b@example.test')
    .addWorkspace('ws-a', 'user-a').addWorkspace('ws-b', 'user-b')
    .setActive('user-a', 'ws-a').setActive('user-b', 'ws-b').syncIdentityTables();
  const seen = installPlatforms(db, {});
  db.install();
  connections._resolvedCache.clear();
  return { db, seen };
}

function connect(db, provider, secrets, extra) {
  const e = Object.assign({ ws: 'ws-a', config: {}, scopes: [], status: 'active' }, extra || {});
  const row = db.insert('workspace_connections', {
    workspace_id: e.ws, provider, category: CATEGORY[provider] || 'social', auth_kind: 'oauth', label: provider,
    config: e.config, secret_fields: Object.keys(secrets), secret_hint: 'xxxx', status: e.status,
    connect_kind: 'oauth', oauth_scopes: e.scopes, token_expires_at: new Date(Date.now() + 30 * DAY).toISOString(),
    refresh_failure_count: 0, revoked_at: null, external_account_id: e.account || null, external_account_label: e.accountLabel || null,
    last_check_note: '',
  });
  db.insert('workspace_connection_secrets', Object.assign({ connection_id: row.id, workspace_id: e.ws }, connections.encryptSecrets(secrets)));
  return row;
}

const META = { secrets: { access_token: 'meta-tok-ws-a' }, config: { page_id: 'page-1', publishing_enabled: true }, scopes: ['pages_manage_posts', 'pages_read_engagement'], accountLabel: 'Brand A Page' };
const PIN = { secrets: { access_token: 'pina_ws_a' }, config: { board_id: 'board-9', publishing_enabled: true }, scopes: ['boards:read', 'boards:write', 'pins:read', 'pins:write'] };

/** A day-package post as social-core.persistPosts saves it, already approved. */
function post(db, key, platform, date, extra) {
  return db.insert('social_posts_generated', {
    workspace_id: 'ws-a', date, platform, format: 'feed', status: 'approved', push_status: 'not_integrated_phase_2',
    payload: Object.assign({
      key, platform, date, market: 'IN', theme: 'One of one',
      copy: { caption: 'Hand-painted, one of one.', title: 'Grail rotation' }, hashtags: ['#grail'],
      link: 'https://brand.example/p/1', alt_text: 'A hand-painted pair',
      media: { type: 'image', image_url: `${MEDIA}/pin.jpg` }, best_time_utc: '17:30', status: 'approved',
    }, extra || {}),
  });
}

const tomorrow = () => new REAL_DATE(REAL_DATE.now() + DAY).toISOString().slice(0, 10);
const jobs = (db) => db.table('dispatch_jobs');
const rowOf = (db, id) => db.table('social_posts_generated').find((r) => r.id === id);
const platformCalls = (db) => db.external().filter((c) => !c.url.startsWith(MEDIA));
const live = (...s) => { process.env.LIVE_CONNECTORS = 'on'; for (const k of s) process.env[k] = '1'; };
const drain = () => dispatch.drain({ selfFire: false });

test('approve -> one job per CONNECTED platform at the post\'s hour in the brand\'s zone; nothing before it; at the due time the platform is reached with the workspace\'s own token and the post reads posted; never twice', async () => {
  const { db, seen } = world();
  connect(db, 'meta_ads', META.secrets, META);
  connect(db, 'pinterest', PIN.secrets, PIN);
  // Another brand's TikTok is connected; this brand's is not. It must not be used.
  connect(db, 'tiktok', { access_token: 'act.other-brand' }, { ws: 'ws-b', config: { publishing_enabled: true, brand_content_toggle: false } });
  live('META_ALLOW_WRITES', 'PINTEREST_ALLOW_WRITES', 'TIKTOK_ALLOW_WRITES');

  const day = tomorrow();
  const fb = post(db, 'facebook', 'facebook', day);
  const pin = post(db, 'pinterest', 'pinterest', day, { best_time_utc: '20:00' });
  const tt = post(db, 'tiktok', 'tiktok', day, { media: { type: 'video', video: { url: `${MEDIA}/clip.mp4` } } });
  const li = post(db, 'linkedin', 'linkedin', day);

  const outFb = await autopost.scheduleSocialPost(AUTH_A, 'ws-a', fb.id, { brand: BRAND });
  const outPin = await autopost.scheduleSocialPost(AUTH_A, 'ws-a', pin.id, { brand: BRAND });
  const outTt = await autopost.scheduleSocialPost(AUTH_A, 'ws-a', tt.id, { brand: BRAND });
  const outLi = await autopost.scheduleSocialPost(AUTH_A, 'ws-a', li.id, { brand: BRAND });

  expect(outFb.scheduled[0], JSON.stringify(outFb)).toMatchObject({ state: 'queued', channel: 'facebook_page_feed', provider: 'meta_ads', account: 'Brand A Page' });
  expect(outPin.scheduled[0], JSON.stringify(outPin)).toMatchObject({ state: 'queued', channel: 'pinterest_pin' });
  // 17:30 and 20:00 in Asia/Kolkata (UTC+5:30) are 12:00 and 14:30 UTC on the post's own day.
  expect(outFb.scheduled[0].scheduled_for).toBe(`${day}T12:00:00.000Z`);
  expect(outPin.scheduled[0].scheduled_for).toBe(`${day}T14:30:00.000Z`);
  expect(outTt.scheduled[0]).toMatchObject({ state: 'skipped', reason: 'not_connected' });
  expect(outTt.scheduled[0].message).toMatch(/TikTok is not connected on this brand.*Connections.*Connect on TikTok/);
  expect(outLi.scheduled[0]).toMatchObject({ state: 'skipped', reason: 'no_channel' });
  expect(outLi.scheduled[0].message).toMatch(/LinkedIn has no publishing adapter/);

  expect(jobs(db).map((j) => j.channel).sort()).toEqual(['facebook_page_feed', 'pinterest_pin']);
  for (const j of jobs(db)) {
    expect(j).toMatchObject({ workspace_id: 'ws-a', mode: 'schedule', status: 'queued', asset_kind: 'social_post' });
    expect(j.idempotency_key).toMatch(/^autopost:social:/);
  }
  expect(rowOf(db, fb.id).push_status).toBe('scheduled');
  expect(rowOf(db, tt.id).push_status).toBe('not_connected');
  expect(rowOf(db, li.id).push_status).toBe('no_channel');

  // The scheduler runs before the post's time: nothing leaves.
  db.clearCalls();
  const early = await drain();
  expect(early.ran).toBe(0);
  expect(platformCalls(db)).toHaveLength(0);

  // The scheduler's run after the due time.
  shiftClock(2 * DAY);
  const due = await drain();
  expect(due.ran).toBe(2);
  const fbSent = seen.meta.find((c) => c.path === '/v25.0/page-1/feed' && c.method === 'POST');
  expect(fbSent, 'the Facebook Page feed was posted').toBeTruthy();
  expect(fbSent.sent).toEqual({ published: true, message: 'Hand-painted, one of one.\n\n#grail', link: 'https://brand.example/p/1' });
  expect(JSON.stringify([fbSent.query, fbSent.headers]), 'with the WORKSPACE\'S own Meta token').toContain('meta-tok-ws-a');
  const pinSent = seen.pinterest.find((c) => c.path === '/v5/pins' && c.method === 'POST');
  expect(pinSent.headers.authorization).toBe('Bearer pina_ws_a');
  expect(pinSent.sent).toMatchObject({ board_id: 'board-9', title: 'Grail rotation', link: 'https://brand.example/p/1' });
  expect(seen.tiktok, 'another brand\'s TikTok is never used').toHaveLength(0);

  expect(jobs(db).every((j) => j.status === 'succeeded')).toBe(true);
  expect(rowOf(db, fb.id)).toMatchObject({ status: 'posted', push_status: 'posted' });
  expect(rowOf(db, fb.id).payload.autopost.channels[0]).toMatchObject({ channel: 'facebook_page_feed', state: 'succeeded', external_id: 'page-1_post_1' });
  expect(rowOf(db, pin.id)).toMatchObject({ status: 'posted', push_status: 'posted' });

  // Approving again, and draining again, never posts twice.
  const again = await autopost.scheduleSocialPost(AUTH_A, 'ws-a', fb.id, { brand: BRAND });
  expect(again.scheduled[0]).toMatchObject({ state: 'queued', deduped: true });
  expect(jobs(db)).toHaveLength(2);
  db.clearCalls();
  const second = await drain();
  expect(second.ran).toBe(0);
  expect(platformCalls(db)).toHaveLength(0);
  expect(seen.meta.filter((c) => c.path === '/v25.0/page-1/feed' && c.method === 'POST')).toHaveLength(1);
});

test('with a switch off the due job is withheld with the exact request, the platform is not called, and the post says so', async () => {
  for (const k of [
    { name: 'LIVE_CONNECTORS', env: () => { process.env.META_ALLOW_WRITES = '1'; }, publishing: true, blocked_by: 'live_connectors_off' },
    { name: 'the brand\'s publishing toggle', env: () => live('META_ALLOW_WRITES'), publishing: false, blocked_by: 'workspace_publishing_off' },
    { name: 'META_ALLOW_WRITES', env: () => live(), publishing: true, blocked_by: 'platform_writes_off' },
  ]) {
    baseEnv(); global.Date = REAL_DATE;
    const { db } = world();
    connect(db, 'meta_ads', META.secrets, Object.assign({}, META, { config: { page_id: 'page-1', publishing_enabled: k.publishing } }));
    k.env();
    const p = post(db, 'facebook', 'facebook', tomorrow());
    const out = await autopost.scheduleSocialPost(AUTH_A, 'ws-a', p.id, { brand: BRAND });
    expect(out.scheduled[0].state, `${k.name}: ${JSON.stringify(out)}`).toBe('queued');
    shiftClock(2 * DAY);
    db.clearCalls();
    await drain();
    const job = jobs(db)[0];
    expect(job.status, k.name).toBe('blocked');
    expect(job.result.blocked_by).toBe(k.blocked_by);
    expect(job.result.would_request.url).toContain('/page-1/feed');
    expect(job.result.would_request.body).toEqual({ published: true, message: 'Hand-painted, one of one.\n\n#grail', link: 'https://brand.example/p/1' });
    expect(JSON.stringify(job.result)).not.toContain('meta-tok-ws-a');
    expect(platformCalls(db), `${k.name}: nothing reaches Meta`).toHaveLength(0);
    expect(rowOf(db, p.id)).toMatchObject({ status: 'approved', push_status: 'withheld' });
    expect(rowOf(db, p.id).payload.autopost.channels[0].state).toBe('blocked');
  }
});

test('a connection waiting on a reconnect is not used, and a missing fact is the preflight\'s marker, never a default', async () => {
  const { db } = world();
  connect(db, 'meta_ads', META.secrets, Object.assign({}, META, { status: 'needs_reauth' }));
  connect(db, 'tiktok', { access_token: 'act.tt-1' }, { config: { publishing_enabled: true }, scopes: ['video.publish'] });
  live('META_ALLOW_WRITES', 'TIKTOK_ALLOW_WRITES');
  const fb = post(db, 'facebook', 'facebook', tomorrow());
  const out = await autopost.scheduleSocialPost(AUTH_A, 'ws-a', fb.id, { brand: BRAND });
  expect(out.scheduled[0]).toMatchObject({ state: 'skipped', reason: 'needs_reauth' });
  expect(out.scheduled[0].message).toMatch(/Reconnect/);

  // TikTok connected, but the brand never stated its branded-content disclosure
  // on the connection: the adapter's marker, and the gate blocks it.
  const tt = post(db, 'tiktok', 'tiktok', tomorrow(), { media: { type: 'video', video: { url: `${MEDIA}/clip.mp4` } } });
  const t = await autopost.scheduleSocialPost(AUTH_A, 'ws-a', tt.id, { brand: BRAND });
  expect(t.scheduled[0].state).toBe('blocked');
  expect(t.scheduled[0].message).toMatch(/DATA REQUIRED BEFORE LAUNCH: brand_content_toggle/);
  expect(jobs(db)).toHaveLength(0);
  expect(rowOf(db, tt.id).push_status).toBe('blocked');
});

test('only an approved post is scheduled; the hour is read in the brand\'s zone, and with no zone it is UTC and said', () => {
  expect(autopost.localToUtc('2026-07-01', '17:30', 'Europe/London')).toBe('2026-07-01T16:30:00.000Z');
  expect(autopost.localToUtc('2026-01-15', '17:30', 'Europe/London')).toBe('2026-01-15T17:30:00.000Z');
  expect(autopost.localToUtc('2026-03-10', '01:00', 'Asia/Kolkata')).toBe('2026-03-09T19:30:00.000Z');
  const noZone = autopost.sendTimeFor({ date: '2099-01-02', payload: { best_time_utc: '08:30' } }, { name: 'Bare' }, Date.now());
  expect(noZone.at).toBe('2099-01-02T08:30:00.000Z');
  expect(noZone.note).toMatch(/read as UTC/);
});

test('a draft is not scheduled', async () => {
  const { db } = world();
  connect(db, 'meta_ads', META.secrets, META);
  const p = post(db, 'facebook', 'facebook', tomorrow());
  db.table('social_posts_generated').find((r) => r.id === p.id).status = 'draft';
  const out = await autopost.scheduleSocialPost(AUTH_A, 'ws-a', p.id, { brand: BRAND });
  expect(out.ok).toBe(false);
  expect(out.message).toMatch(/Only an approved post/);
  expect(jobs(db)).toHaveLength(0);
});
