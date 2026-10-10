/**
 * PIN-only sign-in (2026-10-09).
 * ---------------------------------------------------------------------------
 * The owner's words: "only keep PIN option, that too only 4-digit". Google
 * sign-in through Supabase Auth ran from 2026-10-05 to 2026-10-09; it is
 * removed from auth.js, and every server gate that verifies a Supabase
 * session refuses one an OAuth provider minted, so turning the provider back
 * on in a dashboard is not a way in either. This file replaces
 * tests/google-signin.spec.js and holds:
 *
 *   A. The PIN rules on the server (mobile-auth-core.enter over an in-memory
 *      store): the right PIN signs in, a wrong one counts down, the fifth
 *      locks for fifteen minutes, a 3- or 5-digit PIN is refused without
 *      spending a try, and a BURST of guesses cannot reach the right PIN once
 *      five tries are claimed - each try is claimed before it is checked.
 *   B. The old routes are gone: requireUser(), the analytics operator gate and
 *      the PIN broker's op=me refuse a GoTrue session whose provider is
 *      google, while a mobile + PIN account is still admitted.
 *   C. The browser: the rail offers only "Sign in", which opens the mobile +
 *      PIN panel; the Supabase client is anonymous and never asked for a
 *      session or an OAuth redirect; a Google session the SDK would have
 *      restored is not a sign-in; the device-only PIN (no account database)
 *      claims each try first and refuses a 3- or 5-digit PIN.
 *
 * Run: npx playwright test tests/pin-only-signin.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORE = require.resolve('../api/_shared/mobile-auth-core.js');
const PHONE = require.resolve('../api/_shared/phone-rules.js');
const BRAND_CORE = require.resolve('../api/_shared/brand-workspace-core.js');
const SUPA_AUTH = require.resolve('../api/_shared/mobile-auth-supabase.js');
const DATA_CORE = require.resolve('../api/_shared/data-analysis-core.js');

const ENV_KEYS = ['DATABASE_URL', 'NEON_DATABASE_URL', 'POSTGRES_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY',
  'CRON_SECRET', 'MOBILE_PIN_PEPPER', 'ANALYTICS_ADMIN_DOMAINS'];
const saved = {};
let savedFetch;
test.beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  savedFetch = global.fetch;
});
test.afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  global.fetch = savedFetch;
});

const fresh = (p) => { delete require.cache[p]; return require(p); };

/* ═══ A. the PIN rules, on the server ═════════════════════════════════════ */

/**
 * The account row and the statements mobile-auth-core.enter() issues, run one
 * at a time in the order issued (a single connection's view), so concurrent
 * enter() calls interleave at every statement boundary. Throws on anything
 * else, so a statement the core adds later cannot pass by accident.
 */
function store() {
  const db = { users: [], sessions: [], limits: [] };
  let seq = 0;
  let chain = Promise.resolve();
  const exec = async (strings, vals) => {
    const text = strings.join(' $ ').replace(/\s+/g, ' ').trim().toLowerCase();
    const byId = (id) => db.users.find((u) => u.id === id);
    const lockedNow = (u) => !!(u.locked_until && new Date(u.locked_until) > new Date());
    if (text.startsWith('insert into app_rate_limits')) return [{ n: 1 }];
    if (/^select id, name, phone, pin_hash, pin_salt, pin_tries, locked_until from app_users where phone = \$$/.test(text)) {
      return db.users.filter((u) => u.phone === vals[0]).map((u) => Object.assign({}, u));
    }
    if (text.startsWith('insert into app_users')) {
      const [phone, cc, local, name, hash, salt] = vals;
      const row = { id: 'u' + (++seq), phone, phone_cc: cc, phone_local: local, name, pin_hash: hash, pin_salt: salt, pin_tries: 0, locked_until: null };
      db.users.push(row);
      return [Object.assign({}, row)];
    }
    if (text.startsWith('update app_users set pin_tries = case when locked_until is not null and locked_until <= now() then 1 else pin_tries + 1 end')
      && text.endsWith('where id = $ and (locked_until is null or locked_until <= now()) returning pin_tries')) {
      const u = byId(vals[0]);
      if (!u || lockedNow(u)) return [];
      if (u.locked_until) { u.pin_tries = 1; u.locked_until = null; } else u.pin_tries += 1;
      return [{ pin_tries: u.pin_tries }];
    }
    if (text === 'update app_users set pin_tries = 0, locked_until = $ ::timestamptz where id = $ and (locked_until is null or locked_until <= now())') {
      const u = byId(vals[1]);
      if (u && !lockedNow(u)) { u.pin_tries = 0; u.locked_until = vals[0]; }
      return [];
    }
    if (text === 'select locked_until from app_users where id = $') {
      const u = byId(vals[0]); return u ? [{ locked_until: u.locked_until }] : [];
    }
    if (text.startsWith('update app_users set pin_tries = 0, locked_until = null where id = $')) {
      const u = byId(vals[0]); if (u) { u.pin_tries = 0; u.locked_until = null; } return [];
    }
    if (text.startsWith('insert into app_sessions')) { db.sessions.push({ token_hash: vals[0], user_id: vals[1] }); return []; }
    if (text.startsWith('delete from app_sessions where expires_at < now()')) return [];
    throw new Error('pin-only store: unhandled statement: ' + text);
  };
  const sql = (strings, ...vals) => { const run = chain.then(() => exec(strings, vals)); chain = run.catch(() => {}); return run; };
  sql.db = db;
  return sql;
}

const IN = { phone: '9876543210', cc: '+91' };
const PIN = '7391';
const WRONG = '1357';
const enter = (core, pg, extra) => core.enter(pg, Object.assign({}, IN, extra || {}), '203.0.113.7');

test('A: the right PIN signs in; a wrong one counts down 4, 3, 2, 1; the fifth locks for fifteen minutes', async () => {
  const core = (delete require.cache[PHONE], fresh(CORE));
  const pg = store();
  const made = await enter(core, pg, { name: 'Asha', pin: PIN });
  expect(made.status).toBe(200);
  expect(made.body.token).toBeTruthy();
  // The PIN is stored only as a salted scrypt hash.
  const row = pg.db.users[0];
  expect(Object.values(row).map(String)).not.toContain(PIN);
  expect(row.pin_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(core.verifyPin(PIN, row.pin_salt, row.pin_hash)).toBe(true);

  const right = await enter(core, pg, { pin: PIN });
  expect(right.status).toBe(200);
  expect(right.body.token).toBeTruthy();

  const answers = [];
  for (let i = 0; i < 5; i++) answers.push(await enter(core, pg, { pin: WRONG }));
  expect(answers.slice(0, 4).map((r) => [r.status, r.body.left])).toEqual([[401, 4], [401, 3], [401, 2], [401, 1]]);
  expect(answers[0].body.message).toBe('That PIN is not right. 4 tries left.');
  expect(answers[3].body.message).toBe('That PIN is not right. 1 try left.');
  expect(answers[4].status).toBe(429);
  expect(answers[4].body).toMatchObject({ locked: true, error: 'pin_locked' });
  expect(answers[4].body.message).toBe('Too many wrong PINs. Try again in 15 minutes.');
  const mins = (new Date(pg.db.users[0].locked_until) - Date.now()) / 60000;
  expect(mins).toBeGreaterThan(14);
  expect(mins).toBeLessThanOrEqual(15);
  const locked = await enter(core, pg, { pin: PIN });
  expect(locked.status, 'the right PIN opened a locked account').toBe(429);
  expect(locked.body.token).toBeUndefined();
});

test('A: a 3-digit or 5-digit PIN is refused, at sign-up and at sign-in, and does not spend a try', async () => {
  const core = (delete require.cache[PHONE], fresh(CORE));
  const pg = store();
  for (const bad of ['739', '73915']) {
    const up = await enter(core, pg, { name: 'Asha', pin: bad });
    expect(up.body, bad).toMatchObject({ ok: true, exists: false, needPin: true, error: 'pin_invalid' });
    expect(up.body.message, bad).toBe('Your PIN is 4 digits, you typed ' + bad.length + '.');
  }
  expect(pg.db.users.length, 'an account was made with a PIN that is not 4 digits').toBe(0);
  await enter(core, pg, { name: 'Asha', pin: PIN });
  for (const bad of ['739', '73915', '73a1']) {
    const r = await enter(core, pg, { pin: bad });
    expect(r.status, bad).toBe(200);
    expect(r.body, bad).toMatchObject({ exists: true, needPin: true, error: 'pin_invalid' });
    expect(r.body.token, bad).toBeUndefined();
  }
  expect(pg.db.users[0].pin_tries, 'a malformed PIN was counted as a guess').toBe(0);
  // A 5-digit PIN that STARTS with the right four is not the right PIN.
  const longer = await enter(core, pg, { pin: PIN + '0' });
  expect(longer.body.token).toBeUndefined();
});

test('A: a burst of guesses cannot reach the right PIN once five tries are claimed - each try is claimed before it is checked', async () => {
  const core = (delete require.cache[PHONE], fresh(CORE));
  const pg = store();
  await enter(core, pg, { name: 'Asha', pin: PIN });
  // Seven wrong guesses and then the right one, all in flight at once. When a
  // try was counted only AFTER a wrong verify, every guess in the burst was
  // checked before the count reached five, and the right one signed in.
  const burst = await Promise.all([WRONG, '2468', '8642', '1593', '3579', '9517', '7531', PIN].map((pin) => enter(core, pg, { pin })));
  expect(burst.filter((r) => r.body.token), 'a guess past the fifth try was checked and signed in').toEqual([]);
  expect(burst.filter((r) => r.status === 401).length).toBe(4);
  expect(burst.filter((r) => r.status === 429).length).toBe(4);
  expect(pg.db.users[0].locked_until).toBeTruthy();
  expect(pg.db.sessions.length, 'a session was issued during the burst').toBe(1);   // the sign-up's own
});

/* ═══ B. the old sign-in routes are gone on the server ════════════════════ */

const GOOGLE_USER = { id: '11111111-1111-4111-8111-111111111111', email: 'someone@gmail.com', phone: '', app_metadata: { provider: 'google', providers: ['google'] }, identities: [{ provider: 'google' }], user_metadata: { name: 'Someone' } };
const PIN_USER = { id: '22222222-2222-4222-8222-222222222222', email: '', phone: '919876543210', app_metadata: { provider: 'phone', providers: ['phone'], lifecycle_account: 'mobile-pin', phone_e164: '+919876543210' }, user_metadata: { name: 'Asha' } };
const JWT = { google: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJnb29nbGUifQ.c2lnbmF0dXJl', pin: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwaW4ifQ.c2lnbmF0dXJl' };

/** GoTrue's GET /auth/v1/user and /auth/v1/health, and nothing else. */
function gotrue() {
  const calls = [];
  global.fetch = async (url, init) => {
    const u = new URL(String(url));
    const auth = String(((init && init.headers) || {}).authorization || ((init && init.headers) || {}).Authorization || '');
    calls.push(u.pathname);
    const json = (status, body) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.pathname === '/auth/v1/health') return json(200, {});
    if (u.pathname === '/auth/v1/user') {
      if (auth === 'Bearer ' + JWT.google) return json(200, GOOGLE_USER);
      if (auth === 'Bearer ' + JWT.pin) return json(200, PIN_USER);
      return json(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
    }
    throw new Error('gotrue fake: unexpected ' + u.pathname);
  };
  return calls;
}

function supabaseEnv() {
  process.env.SUPABASE_URL = 'https://project.example.test';
  process.env.SUPABASE_ANON_KEY = 'anon-public-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
}

test('B: requireUser() refuses a session Google minted, and still admits a mobile + PIN account', async () => {
  supabaseEnv();
  const calls = gotrue();
  fresh(SUPA_AUTH);
  const core = fresh(BRAND_CORE);
  const google = await core.requireUser({ headers: { authorization: 'Bearer ' + JWT.google } });
  expect(google).toMatchObject({ ok: false, status: 401, error: 'sign_in_required', provider_refused: 'google' });
  expect(google.message).toMatch(/mobile number and PIN/);
  expect(google.user_id, 'a refused caller carried an identity').toBeUndefined();
  const pin = await core.requireUser({ headers: { authorization: 'Bearer ' + JWT.pin } });
  expect(pin).toMatchObject({ ok: true, provider: 'mobile-pin', mode: 'supabase', phone: '+919876543210', user_id: PIN_USER.id });
  expect(calls.filter((p) => p === '/auth/v1/user').length).toBe(2);
});

test('B: the analytics operator gate and the PIN broker refuse a Google session too', async () => {
  supabaseEnv();
  gotrue();
  const supa = fresh(SUPA_AUTH);
  fresh(BRAND_CORE);
  const data = fresh(DATA_CORE);
  expect(await data.authorize({ headers: { authorization: 'Bearer ' + JWT.google } })).toMatchObject({ ok: false, status: 401, error: 'invalid_operator_session' });
  expect(await data.authorize({ headers: { authorization: 'Bearer ' + JWT.pin } })).toMatchObject({ ok: true });
  const cfg = supa.config();
  const me = await supa.me(cfg, { headers: { authorization: 'Bearer ' + JWT.google } });
  expect(me.status).toBe(401);
  expect(me.body).toMatchObject({ ok: false, error: 'invalid_session' });
  const mine = await supa.me(cfg, { headers: { authorization: 'Bearer ' + JWT.pin } });
  expect(mine.status).toBe(200);
  expect(mine.body.user).toMatchObject({ id: PIN_USER.id, phone: '+919876543210' });
  // Which accounts count as OAuth: the record GoTrue returns, never the request.
  expect(supa.oauthProvider(GOOGLE_USER)).toBe('google');
  expect(supa.oauthProvider({ app_metadata: { provider: 'email', providers: ['email', 'google'] } })).toBe('google');
  expect(supa.oauthProvider(PIN_USER)).toBe('');
  expect(supa.oauthProvider({ app_metadata: {}, user_metadata: { provider: 'google' } }), 'user_metadata is user-editable and is not read').toBe('');
});

/* ═══ C. the browser ══════════════════════════════════════════════════════ */

const ORIGIN = 'http://localhost:3099';
const googleSession = { access_token: 'google-session-token', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'google-user', email: 'someone@gmail.com', app_metadata: { provider: 'google' }, user_metadata: { name: 'Google User' } } };

async function boot(page, options = {}) {
  const requests = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/auth.js') return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8') });
    if (url.pathname === '/api/public-config' && !url.search) return route.fulfill({ json: { supabase: { url: 'https://auth.example.com', anonKey: 'public-test-key' } } });
    if (url.pathname === '/api/public-config' && /op=status/.test(url.search)) {
      return route.fulfill({ json: { ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' } });
    }
    if (url.pathname.startsWith('/api/')) {
      requests.push({ url: url.href, authorization: route.request().headers().authorization || '' });
      return route.fulfill({ json: { ok: true, entries: [] } });
    }
    if (url.pathname === '/auth/v1/health') return route.fulfill({ json: {} });
    if (url.pathname === '/brain') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body><h1>Brain</h1><script src="/auth.js"></script></body></html>' });
    return route.fulfill({ contentType: 'text/javascript', body: '' });
  });
  await page.addInitScript(({ session }) => {
    window.sdk = { oauth: [], getSession: 0, onAuthStateChange: 0, options: null };
    window.supabase = { createClient: (_url, _key, opts) => {
      window.sdk.options = opts;
      return { auth: {
        getSession: async () => { window.sdk.getSession++; return { data: { session }, error: null }; },
        onAuthStateChange: () => { window.sdk.onAuthStateChange++; return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithOAuth: async (args) => { window.sdk.oauth.push(args); return { error: null }; },
        signOut: async () => ({ error: null }),
        setSession: async () => ({ data: {}, error: null }),
      } };
    } };
  }, { session: options.session || null });
  await page.goto(ORIGIN + '/brain');
  await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending', null, { timeout: 15000 });
  await page.evaluate(() => window.LifecycleAuth.ready());
  return requests;
}

test('C: the rail offers only "Sign in", which opens the mobile + PIN panel; the client is anonymous and never starts OAuth', async ({ page }) => {
  await boot(page);
  const chip = page.locator('#lnav-signin');
  await expect(chip).toHaveText('Sign in');
  await expect(page.getByText(/sign in with (gmail|google)/i)).toHaveCount(0);
  await chip.click();
  await expect(page.locator('#lnav-mauth')).toHaveCount(1);
  await expect(page.locator('#lnav-mauth-title')).toHaveText('Sign in with your mobile number');
  const pin = page.locator('#lnav-mauth-pin');
  await expect(pin).toHaveAttribute('inputmode', 'numeric');
  await expect(pin).toHaveAttribute('maxlength', '4');
  await expect(pin).toHaveAttribute('type', 'password');
  const sdk = await page.evaluate(() => window.sdk);
  expect(sdk.oauth, 'signInWithOAuth was called').toEqual([]);
  expect(sdk.options.auth).toEqual({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  expect(await page.evaluate(() => ({ g: typeof window.__startGoogleSignIn__, o: typeof window.LifecycleAuth.googleSignInOptions, r: typeof window.LifecycleAuth.restoreReturnTo })))
    .toEqual({ g: 'undefined', o: 'undefined', r: 'undefined' });
});

test('C: a Google session the SDK would restore is not a sign-in, and no API call carries its token', async ({ page }) => {
  const calls = await boot(page, { session: googleSession });
  await page.evaluate(() => fetch('/api/calendar?action=smart-brain-plan'));
  expect(await page.evaluate(() => window.LifecycleAuth.user)).toBeNull();
  expect(await page.evaluate(() => window.LifecycleAuth.apiToken())).toBe('');
  expect(calls.filter((c) => /google-session-token/.test(c.authorization))).toEqual([]);
  const sdk = await page.evaluate(() => ({ getSession: window.sdk.getSession, onAuthStateChange: window.sdk.onAuthStateChange }));
  expect(sdk, 'auth.js asked the SDK for a session or subscribed to one').toEqual({ getSession: 0, onAuthStateChange: 0 });
  await expect(page.locator('#lnav-signin')).toHaveText('Sign in');
});

test('C: a canonical Lifecycle OS host is kept: a generated Vercel URL moves the full route to it', async ({ page }) => {
  const requested = 'https://lifecycle-os-preview-123-anchit-ai-hustle.vercel.app/smart-brain.html?tab=calendar#week';
  const canonical = 'https://lifecycle-os.anchit-tandon.com/smart-brain.html?tab=calendar#week';
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'lifecycle-os-preview-123-anchit-ai-hustle.vercel.app' && url.pathname === '/auth.js') {
      return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8') });
    }
    if (url.hostname === 'lifecycle-os-preview-123-anchit-ai-hustle.vercel.app') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/auth.js"></script>' });
    if (url.hostname === 'lifecycle-os.anchit-tandon.com') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Canonical</title>' });
    return route.abort();
  });
  await page.goto(requested);
  await expect.poll(() => page.url()).toBe(canonical);
});

test('C: a device-only PIN (no account database) refuses 3 and 5 digits, counts down, locks at five, and claims each try first', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const enter = (b) => window.LifecycleAuth.mobile.deviceEnter(Object.assign({ phone: '9876543210', cc: '+91' }, b));
    const out = {};
    out.made = (await enter({ name: 'Asha', pin: '7391' })).status;
    out.short = (await enter({ pin: '739' })).body;
    out.long = (await enter({ pin: '73915' })).body;
    out.left = [];
    for (let i = 0; i < 4; i++) out.left.push((await enter({ pin: '1357' })).body.left);
    out.fifth = (await enter({ pin: '1357' })).body;
    out.lockedRight = (await enter({ pin: '7391' })).status;
    // A fresh account, and a burst: five wrong and the right one at once.
    localStorage.removeItem(window.LifecycleAuth.mobile.USERS_KEY);
    await enter({ name: 'Asha', pin: '7391' });
    const burst = await Promise.all(['1357', '2468', '8642', '1593', '3579', '7391'].map((pin) => enter({ pin })));
    out.burstTokens = burst.filter((x) => x.body.token).length;
    out.burstLocked = burst.filter((x) => x.status === 429).length;
    const users = JSON.parse(localStorage.getItem(window.LifecycleAuth.mobile.USERS_KEY) || '{}');
    out.stored = Object.values(users).flatMap((u) => Object.values(u).map(String));
    return out;
  });
  expect(r.made).toBe(200);
  expect(r.short).toMatchObject({ needPin: true, error: 'pin_invalid' });
  expect(r.long).toMatchObject({ needPin: true, error: 'pin_invalid' });
  expect(r.left).toEqual([4, 3, 2, 1]);
  expect(r.fifth).toMatchObject({ locked: true, error: 'pin_locked', message: 'Too many wrong PINs. Try again in 15 minutes.' });
  expect(r.lockedRight).toBe(429);
  expect(r.burstTokens, 'the right PIN in a burst signed in past the fifth try').toBe(0);
  expect(r.burstLocked).toBeGreaterThanOrEqual(1);
  expect(r.stored.length).toBeGreaterThan(0);
  expect(r.stored, 'the PIN itself was stored in the browser').not.toContain('7391');
});
