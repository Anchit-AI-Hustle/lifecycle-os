/**
 * Reading a brand from its own website must not need a database.
 * ---------------------------------------------------------------------------
 * Found on the LIVE deployment, not in the source. The Supabase project this
 * deployment points at is paused, the app correctly opens signed-out and says
 * so - and then the headline control of the FIRST SCREEN, "Read my brand from
 * my website", answered:
 *
 *     Could not read that site
 *     session_verification_unavailable
 *
 * Two independent defects, one screenshot.
 *
 * 1. `?op=extract` sat below `requireUser()`. It reads the public website the
 *    operator just typed and returns a report: it writes nothing, reads no
 *    table, and `runExtract`'s only use of `auth` is an optional getWorkspace()
 *    to widen the crawl scope, already wrapped in a try/catch that degrades. So
 *    with the auth host unreachable the gate protected no data and no spend -
 *    it only guaranteed a 503. This is the 2026-08-30 "login wall that defends
 *    nothing" finding arriving through the SERVER instead of the browser; that
 *    fix opened the pages and left this gate behind them.
 *
 * 2. Every refusal carried a machine CODE and no sentence, and
 *    `brand-context.js` read `json.error || json.message` - the code FIRST.
 *    One line, and every failure in the whole app funnels through it, so the
 *    operator was shown an identifier instead of an explanation.
 *
 * ── WHAT MUST NOT HAPPEN WHILE FIXING IT ───────────────────────────────────
 * Opening the endpoint whenever auth merely FAILS would be an auth bypass, and
 * leaving voice observation on would turn an unreachable database into an
 * unauthenticated LLM proxy spending real provider keys - the 2026-08-23
 * finding, re-introduced by way of a fix. Both directions are asserted here.
 *
 * Every test CALLS the shipped router with a real req/res pair. Nothing asserts
 * on source text.
 *
 * Run: npx playwright test tests/extract-without-backend.spec.js
 */
const { test, expect } = require('@playwright/test');

const CORE = require.resolve('../api/_shared/brand-workspace-core.js');
const EXTRACT = require.resolve('../api/_shared/brand-extract.js');
const LLM = require.resolve('../api/_shared/llm.js');

/** A res that records what the handler actually sent. */
function mockRes() {
  const out = { code: 0, body: null, headers: {} };
  const res = {
    status(c) { out.code = c; return res; },
    json(b) { out.body = b; return res; },
    setHeader(k, v) { out.headers[k] = v; },
    end() { return res; },
  };
  return { res, out };
}

const reqFor = (op, body, auth) => ({
  method: 'POST',
  url: `/api/public-config?action=brand&op=${op}`,
  headers: Object.assign({ 'content-type': 'application/json' }, auth ? { authorization: `Bearer ${auth}` } : {}),
  query: { action: 'brand', op },
  body: body || {},
});

/**
 * Load the router with a controlled world: a fetch that behaves the way a
 * paused Supabase project does (the host does not resolve, so the call THROWS),
 * and a site the extractor can read.
 */
function loadCore({ authFetch, site }) {
  for (const m of [CORE, EXTRACT, LLM]) delete require.cache[m];

  // assertPublicUrl() resolves the hostname for real and refuses any answer on
  // an internal range - the SSRF guard, which must STAY in the path here: this
  // opens an endpoint to unauthenticated callers, so proving the guard still
  // runs is part of the point. A fixture host has no DNS record, so the lookup
  // is stubbed to return one public address. Everything else about the guard -
  // scheme, port, blocked-host and private-IP checks - runs untouched, and
  // `the SSRF guard still refuses a private host` below drives it for real.
  const dns = require('dns').promises;
  const realLookup = dns.lookup;
  dns.lookup = async (host, opts) => {
    if (String(host).endsWith('.example')) return [{ address: '93.184.216.34', family: 4 }];
    return realLookup(host, opts);
  };

  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (/\/auth\/v1\//.test(u)) return authFetch(u, opts);
    const key = u.split('#')[0];
    const row = site[key] || site[key.replace(/\/$/, '')];
    if (row) {
      return {
        ok: true, status: 200, url: key,
        headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? row.ct : null) },
        text: async () => row.body,
        json: async () => JSON.parse(row.body),
      };
    }
    return {
      ok: false, status: 404, url: key,
      headers: { get: () => 'text/plain' },
      text: async () => '', json: async () => ({}),
    };
  };
  const core = require(CORE);
  return { core, restore: () => { global.fetch = realFetch; dns.lookup = realLookup; } };
}

const HOST = 'https://brandsite.example';
const SITE = {
  [`${HOST}/`]: {
    ct: 'text/html',
    body: `<!doctype html><html><head><title>Northwind Tea</title>
      <meta name="generator" content="Shopify">
      <meta property="og:site_name" content="Northwind Tea">
      <meta name="description" content="Single-origin teas.">
      <link rel="stylesheet" href="/theme.css"></head>
      <body><h1>Northwind Tea</h1><a href="/about">About</a>
      <p>We have roasted and blended single-origin tea in Bristol since 2011, and we ship worldwide.</p>
      </body></html>`,
  },
  [`${HOST}/theme.css`]: {
    ct: 'text/css',
    body: ':root{--brand-primary:#2E6F5E;--brand-accent:#D98A3A;--brand-ink:#15201C;--brand-surface:#FBFAF6}'
      + 'h1{font-family:"Canela",Georgia,serif;font-size:44px;font-weight:600;color:#15201C}'
      + 'body{font-family:"Inter",system-ui;font-size:16px;color:#15201C;background:#FBFAF6}',
  },
  [`${HOST}/about`]: {
    ct: 'text/html',
    body: '<!doctype html><html><head><title>About</title></head><body><h1>About</h1>'
      + '<p>Northwind Tea Ltd, 4 Harbour Road, Bristol.</p></body></html>',
  },
  [`${HOST}/robots.txt`]: { ct: 'text/plain', body: 'User-agent: *\nAllow: /\n' },
};

/** A paused project: DNS does not resolve, so fetch REJECTS. */
const DEAD_AUTH = async () => { throw new Error('getaddrinfo ENOTFOUND fswdwmkgggzyxrdzabnh.supabase.co'); };
/** A live project that answers and rejects this caller. */
const LIVE_AUTH_REJECTS = async () => ({
  ok: false, status: 401,
  headers: { get: () => 'application/json' },
  text: async () => '{}', json: async () => ({}),
});

const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];
let saved;
test.beforeEach(() => { saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); });
test.afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

function configure() {
  process.env.SUPABASE_URL = 'https://fswdwmkgggzyxrdzabnh.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key-for-test';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. THE FEATURE WORKS WITH THE DATABASE DOWN
   ═══════════════════════════════════════════════════════════════════════════ */

test('a brand can be read from its own site while the database is unreachable', async () => {
  configure();
  const { core, restore } = loadCore({ authFetch: DEAD_AUTH, site: SITE });
  try {
    const { res, out } = mockRes();
    await core.handle(reqFor('extract', { url: HOST }, 'a-stale-token'), res);

    // The exact failure from the live deployment, asserted as fixed.
    expect(out.code, 'reading a public site should not 503 on a dead database').toBe(200);
    expect(JSON.stringify(out.body)).not.toContain('session_verification_unavailable');

    expect(out.body.ok).toBe(true);
    expect(out.body.pages_visited).toBeGreaterThan(0);
    // And it really read the brand, not an empty shell.
    expect(out.body.fields.name.value).toBe('Northwind Tea');
    expect(out.body.fields.palette.proposed.primary.toLowerCase()).toBe('#2e6f5e');
    expect(out.body.fields.storefront.platform.id).toBe('shopify');
  } finally { restore(); }
});

test('the signed-out read SAYS it is one, rather than passing as a normal success', async () => {
  configure();
  const { core, restore } = loadCore({ authFetch: DEAD_AUTH, site: SITE });
  try {
    const { res, out } = mockRes();
    await core.handle(reqFor('extract', { url: HOST }, 'a-stale-token'), res);

    expect(out.body.signed_out).toBe(true);
    expect(out.body.backend_unreachable).toBe(true);
    expect(out.body.voice_skipped).toBe(true);
    expect(out.body.note).toMatch(/[Nn]othing was saved/);
    expect(out.body.note).toMatch(/tone of voice was NOT observed|voice.*not observed/i);
    // The cause names the host an operator has to change.
    expect(out.body.backend_message).toMatch(/fswdwmkgggzyxrdzabnh\.supabase\.co/);
    expect(out.body.backend_message).toMatch(/deleted, renamed or paused/);
  } finally { restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. IT IS NOT AN AUTH BYPASS, AND NOT AN OPEN LLM PROXY
   ═══════════════════════════════════════════════════════════════════════════ */

test('a backend that ANSWERS and rejects the caller still refuses', async () => {
  // The whole distinction: a reachable backend means a session exists to be
  // had, so the gate is real. Opening on any auth failure would be a bypass.
  configure();
  const { core, restore } = loadCore({ authFetch: LIVE_AUTH_REJECTS, site: SITE });
  try {
    const { res, out } = mockRes();
    await core.handle(reqFor('extract', { url: HOST }, 'a-forged-token'), res);

    expect(out.code).toBe(401);
    expect(out.body.ok).toBe(false);
    expect(out.body.error).toBe('invalid_session');
    expect(out.body.backend_unreachable).toBeUndefined();
    expect(out.body.pages_visited).toBeUndefined();
  } finally { restore(); }
});

test('no language model is called on the signed-out path', async () => {
  // Voice observation is the ONE LLM call in the extractor. Leaving it on would
  // turn an unreachable database into an unauthenticated way to spend provider
  // keys - the 2026-08-23 open-proxy finding, re-introduced by way of a fix.
  //
  // TWO ways of asserting it, because the first version of this test caught
  // neither. `llm.js` does `module.exports = async function callLLM(...)`, so
  // the MODULE IS THE FUNCTION: stubbing a `.callLLM` property replaced a key
  // that does not exist and intercepted nothing. And `voice_skipped` is a flag
  // this handler sets itself, so asserting it only proves the handler can set
  // its own flag. Turning `voice: false` into `voice: true` passed both.
  //
  // So: intercept the require cache (what observeVoice actually resolves), and
  // assert the OUTPUT the extractor produced, which differs by construction.
  configure();
  const { core, restore } = loadCore({ authFetch: DEAD_AUTH, site: SITE });
  let calls = 0;
  const realLlm = require.cache[LLM];
  const stub = async function callLLM() { calls += 1; throw new Error('a provider must not be called here'); };
  stub.parseJSON = (t) => JSON.parse(t);
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
  try {
    const { res, out } = mockRes();
    await core.handle(reqFor('extract', { url: HOST }, 'a-stale-token'), res);

    expect(out.code).toBe(200);
    expect(calls, 'the signed-out path called a language model').toBe(0);

    // The output the extractor itself produced: `voice:false` takes the branch
    // that records "not requested". The observed branch cannot produce this
    // note, so it cannot be faked by the handler's own flag.
    expect(out.body.fields.voice.note).toBe('Voice observation was not requested.');
    expect(out.body.fields.voice.value).toBeNull();
    // And the absence is reported to the operator, not left as a marker that
    // reads like the site published no voice.
    expect(out.body.voice_skipped).toBe(true);
  } finally {
    if (realLlm) require.cache[LLM] = realLlm; else delete require.cache[LLM];
    restore();
  }
});

test('only extract opens; every other operation still requires a session', async () => {
  configure();
  const { core, restore } = loadCore({ authFetch: DEAD_AUTH, site: SITE });
  try {
    // `suggest` is the pointed case: like extract it needs no table, but it
    // CALLS A MODEL, so opening it would be the open-LLM-proxy defect exactly.
    for (const op of ['list', 'active', 'save', 'activate', 'delete', 'catalog-import', 'suggest', 'context-build']) {
      const { res, out } = mockRes();
      await core.handle(reqFor(op, { workspace_id: 'w1', field: 'tagline' }, 'a-stale-token'), res);
      expect(out.code, `${op} must not open when the backend is unreachable`).toBe(503);
      expect(out.body.ok).toBe(false);
      expect(out.body.error).toBe('session_verification_unavailable');
    }
  } finally { restore(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. AN ERROR CODE IS NOT AN ERROR MESSAGE
   ═══════════════════════════════════════════════════════════════════════════ */

test('every refusal carries a sentence a person can act on, not just a code', async () => {
  configure();
  const { core, restore } = loadCore({ authFetch: DEAD_AUTH, site: SITE });
  try {
    const { res, out } = mockRes();
    await core.handle(reqFor('list', {}, 'a-stale-token'), res);

    expect(out.body.error).toBe('session_verification_unavailable');   // kept, for code
    expect(typeof out.body.message).toBe('string');
    expect(out.body.message.length).toBeGreaterThan(30);
    expect(out.body.message).toMatch(/not answering/i);
    expect(out.body.backend_unreachable).toBe(true);
    // A sentence, not an identifier wearing one.
    expect(out.body.message).not.toMatch(/session_verification_unavailable|[a-z]+_[a-z]+_[a-z]+/);
  } finally { restore(); }
});

test('a caller with no token at all is told so in words', async () => {
  configure();
  const { core, restore } = loadCore({ authFetch: DEAD_AUTH, site: SITE });
  try {
    const { res, out } = mockRes();
    await core.handle(reqFor('list', {}, ''), res);
    expect(out.code).toBe(401);
    expect(out.body.error).toBe('sign_in_required');
    expect(out.body.message).toMatch(/not signed in/i);
  } finally { restore(); }
});

test('the browser shows the SENTENCE, not the code — the line every error funnels through', async ({ page }) => {
  // brand-context.js read `json.error || json.message`, so the CODE won every
  // time, and every failure in the app funnels through that one line. Load the
  // real script in a real page and drive the real BrandContext.api() against a
  // stubbed endpoint, so this asserts what a user is actually shown.
  // ROUTE ORDER MATTERS: the LAST matching handler wins, so the broad page
  // route goes first and the specific API route after it. Registered the other
  // way round, the page handler also matches /api/public-config and answers it
  // with 200 HTML - the call then resolves, and this test passes by never
  // exercising the error path at all.
  //
  // A real http origin, because the script calls a RELATIVE API path and
  // about:blank has no origin to resolve it against.
  await page.route('**/blank-host/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><title>t</title>',
  }));
  await page.route('**/api/public-config**', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: false,
      error: 'session_verification_unavailable',
      message: 'The database this deployment points at (fswdwmkgggzyxrdzabnh.supabase.co) is not answering, so sign-in cannot be checked.',
    }),
  }));
  await page.goto('https://blank-host/page');
  await page.addScriptTag({ path: require.resolve('../brand-context.js') });
  await page.waitForFunction(() => !!window.BrandContext);

  const msg = await page.evaluate(async () => {
    try { await window.BrandContext.api('list', {}); return null; }
    catch (e) { return { message: e.message, code: e.code, status: e.status }; }
  });

  expect(msg, 'the call did not reject').toBeTruthy();
  expect(msg.message).toMatch(/is not answering/);
  // The identifier is still carried for code to branch on - just not shown.
  expect(msg.code).toBe('session_verification_unavailable');
  expect(msg.message).not.toBe('session_verification_unavailable');
});

test('the SSRF guard still refuses a private host on the newly-opened endpoint', async () => {
  // This op is now reachable without a session, so the guard that stops it
  // being pointed at an internal address matters more than it did before, not
  // less. Driven for real - no DNS stub, no fetch stub for this host.
  configure();
  const { core, restore } = loadCore({ authFetch: DEAD_AUTH, site: SITE });
  try {
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:8080/']) {
      const { res, out } = mockRes();
      await core.handle(reqFor('extract', { url }, 'a-stale-token'), res);
      expect(out.code, `${url} was not refused`).toBe(400);
      expect(out.body.ok).toBe(false);
      expect(out.body.pages_visited).toBeUndefined();
      expect(String(out.body.message)).toMatch(/private or internal|standard http and https ports/i);
    }
  } finally { restore(); }
});
