// Three findings from the 17 Aug security audit, closed and pinned.
//
// 1. UNAUTHENTICATED LLM PROXY. api/ai/generate.js and api/ai/image.js shipped
//    with Access-Control-Allow-Origin:* and no inbound auth at all, in a public
//    repo. An anonymous POST reached the six-provider cascade in llm.js and
//    spent whichever key answered - OPENAI, ANTHROPIC, GEMINI, XAI, GROQ,
//    CEREBRAS. A grep for "authorization" in image.js found two hits and both
//    were OUTBOUND headers to the providers, which is how it stayed invisible.
//
// 2. SQL INJECTION into Snowflake. `since`/`until` came from req.query on
//    ?action=ads-snowflake - the one case in brain.js with no cron guard - and
//    were interpolated into `between '${since}' and '${until}'`.
//
// 3. ANONYMOUS WRITES. Migration 20260719120000 granted insert/update/delete on
//    smart_generated_campaigns and smart_brain_runs to `anon`, with policies of
//    `using (true)`. smart_users / smart_orders had no RLS at all.
//
// Run: npx playwright test tests/security-endpoints.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ═══ 1. Nobody spends the provider budget without identifying themselves ══ */

for (const route of ['api/ai/generate.js', 'api/ai/image.js']) {
  test(`${route} runs the caller gate before any provider work`, () => {
    /* A SOURCE claim, kept as one deliberately: that the gate is the first
       thing in the handler is a property of the file, and it is cheap to check.
       What it CANNOT prove is that an anonymous POST is actually refused —
       that is a runtime claim, and it is executed in the test below. This one
       stays because it localises a regression to the line that caused it. */
    const src = read(route);
    expect(src, 'the route must run the caller gate before any provider work').toMatch(/requireCaller\(req, res\)/);

    /* Ordering has to be measured INSIDE the handler. Measuring across the whole
       file matched `callLLM` in a require near the top - above the handler
       entirely - and reported a gate that is in fact the first statement as
       though it came last. The requires and the ~900-line prompt block are not
       provider calls. */
    const handlerAt = src.indexOf('async function handler');
    expect(handlerAt, 'the handler should still be recognisable').toBeGreaterThan(-1);
    const body = src.slice(handlerAt);
    const gateAt = body.indexOf('requireCaller');
    const workAt = Math.min(...['callLLM(', 'await fetch(', 'generateContent(']
      .map((m) => { const i = body.indexOf(m); return i < 0 ? Number.MAX_SAFE_INTEGER : i; }));
    expect(gateAt, 'the gate must run before the first provider call in the handler').toBeGreaterThan(-1);
    expect(gateAt, 'the gate must run before the first provider call in the handler').toBeLessThan(workAt);
  });

  test(`${route} does not send a wildcard CORS header`, () => {
    const src = read(route).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    expect(src, 'Access-Control-Allow-Origin:* is what made the open route usable from anywhere')
      .not.toMatch(/Access-Control-Allow-Origin['"]\s*,\s*['"]\*/);
  });
}

/* ── executed, not read ───────────────────────────────────────────────────────
 * The finding was an unauthenticated proxy that spent six real provider keys.
 * Everything above proves a string is present and two indices are ordered. It
 * would still pass if requireCaller were called and its FALSE return ignored,
 * if the module threw and something swallowed it, or if a later wrapper
 * re-entered the handler. The only claim that matters is what a request
 * actually gets, so these send one.
 *
 * The routes are wrapped at export time (credits.metered, then request-scope),
 * so requiring the module gives the SHIPPED entry point, wrappers included —
 * which is the thing an attacker reaches.
 * ────────────────────────────────────────────────────────────────────────── */

function fakeRes() {
  const r = {
    statusCode: null, body: null, headers: {}, ended: false,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; this.ended = true; return this; },
    send(o) { this.body = o; this.ended = true; return this; },
    end() { this.ended = true; return this; },
  };
  return r;
}

/**
 * Hosts that cost money when they are called. Supabase is NOT one of them: the
 * routes are wrapped in credits.metered(), whose own gate runs before the
 * handler and reads the price catalog, so an anonymous request legitimately
 * touches Postgres on its way to being refused. Forbidding ALL network traffic
 * made this test pass alone and fail in the full suite, where an earlier spec
 * had left SUPABASE_URL set — a sharper assertion is also a deterministic one.
 */
const PROVIDER_HOSTS = /(openai|anthropic|googleapis|generativelanguage|x\.ai|groq|cerebras|pollinations|higgsfield|elevenlabs)\./i;

/** Records every request and refuses to let a provider one succeed. */
function watchNetwork(handleSupabase) {
  const real = global.fetch;
  const all = [];
  global.fetch = async (url, init) => {
    const u = String(url);
    all.push(u);
    if (PROVIDER_HOSTS.test(u)) throw new Error(`a provider call escaped the gate: ${u}`);
    if (handleSupabase) return handleSupabase(u, init);
    return { ok: true, status: 200, text: async () => '{}' };
  };
  return {
    all,
    get providers() { return all.filter((u) => PROVIDER_HOSTS.test(u)); },
    /** Calls that would MOVE a balance, as opposed to reading a price list. */
    get balanceMoves() { return all.filter((u) => /\/rpc\/credit_(grant|hold|spend|release|fulfil)/.test(u)); },
    restore() { global.fetch = real; },
  };
}

for (const route of ['api/ai/generate.js', 'api/ai/image.js']) {
  test(`${route} actually refuses an anonymous POST and spends nothing`, async () => {
    // Pinned rather than inherited, so this exercises the SAME path whether or
    // not the runner has Supabase configured and whichever spec ran before it.
    const saved = {
      CRON_SECRET: process.env.CRON_SECRET,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    delete process.env.CRON_SECRET;                    // the scheduler door is shut
    process.env.SUPABASE_URL = 'https://fake.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';

    const net = watchNetwork((u) => {
      // Whatever it asks Supabase, the answer is "this caller is nobody".
      if (/\/auth\/v1\/user/.test(u)) return { ok: false, status: 401, text: async () => '{}' };
      return { ok: true, status: 200, text: async () => '[]' };
    });
    try {
      const handler = require(path.join(ROOT, route));
      expect(typeof handler, `${route} must export a handler`).toBe('function');

      const res = fakeRes();
      await handler(
        { method: 'POST', headers: {}, query: {}, body: { task: 'concepts', prompt: 'hello' } },
        res,
      );

      expect(res.ended, 'the route never answered the anonymous caller').toBe(true);
      expect([401, 402, 503], `an anonymous POST to ${route} got ${res.statusCode}`).toContain(res.statusCode);
      expect(res.body && res.body.ok).toBe(false);
      // The two decisive ones. A 401 that had already called a provider would
      // still have cost money, and an anonymous caller must not put a hold on
      // anybody's balance on the way to being turned away.
      expect(net.providers, `${route} called a provider before refusing`).toEqual([]);
      expect(net.balanceMoves, `${route} moved a credit balance for an anonymous caller`).toEqual([]);
      // And it must not hand a wildcard to the browser on the way out.
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    } finally {
      net.restore();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });

  test(`${route} refuses a forged bearer token without calling a provider`, async () => {
    // A token is not trusted because it is present. requireUser verifies it
    // against Supabase's own /auth/v1/user, and that lookup is the ONLY network
    // call permitted here — a provider call would mean the gate was bypassed.
    const real = global.fetch;
    const seen = [];
    global.fetch = async (url) => {
      const u = String(url);
      seen.push(u);
      if (/\/auth\/v1\/user/.test(u)) {
        return { ok: false, status: 401, text: async () => JSON.stringify({ msg: 'invalid token' }) };
      }
      throw new Error(`a provider call escaped the gate: ${u}`);
    };
    const savedCron = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const handler = require(path.join(ROOT, route));
      const res = fakeRes();
      await handler(
        { method: 'POST', headers: { authorization: 'Bearer not-a-real-token' }, query: {},
          body: { task: 'concepts', prompt: 'hello' } },
        res,
      );
      expect(res.ended).toBe(true);
      expect([401, 503], `forged token got ${res.statusCode}`).toContain(res.statusCode);
      expect(seen.filter((u) => !/\/auth\/v1\/user/.test(u)),
        'a provider was called on behalf of a forged token').toEqual([]);
    } finally {
      global.fetch = real;
      if (savedCron === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = savedCron;
    }
  });
}

test('the gate accepts a session or the scheduler, and nothing else', () => {
  const src = read('api/_shared/require-caller.js');
  expect(src).toMatch(/requireUser/);          // a real Supabase JWT check
  expect(src).toMatch(/CRON_SECRET/);          // the deployment's own scheduler
  expect(src).toMatch(/\b401\b/);
  expect(src).toMatch(/\b429\b/);
});

test('the rate limiter does not become its own denial of service', () => {
  // The key is attacker-controlled, so an unbounded map is a memory leak with
  // a helpful name.
  expect(read('api/_shared/require-caller.js')).toMatch(/MAX_KEYS/);
});

/* ═══ 2. A date, or nothing ════════════════════════════════════════════════ */

test('date filters reject anything that is not an ISO calendar date', () => {
  const core = require(path.join(ROOT, 'api', '_shared', 'ads-snowflake-core.js'));
  for (const bad of [
    "2026-01-01' or '1'='1",
    "2026-01-01'; drop table x --",
    "2026-01-01' union select 1,2,3 --",
    '2026-02-31',            // right shape, impossible date
    'yesterday', '', null, undefined, 0, {},
  ]) {
    expect(core.isoDate(bad), `${JSON.stringify(bad)} must not reach SQL`).toBe('');
  }
  expect(core.isoDate('2026-01-01')).toBe('2026-01-01');
  expect(core.isoDate(' 2026-12-31 ')).toBe('2026-12-31');
});

test('no date value is interpolated into SQL without passing the validator', () => {
  const src = read('api/_shared/ads-snowflake-core.js')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  // The raw parameters must never appear inside a quoted SQL fragment again.
  expect(src, 'raw `since`/`until` interpolated into SQL').not.toMatch(/between '\$\{since\}'/);
  expect(src).not.toMatch(/between '\$\{until\}'/);
});

/* ═══ 3. The anon key opens nothing ════════════════════════════════════════ */

test('a migration revokes anonymous access to customer data and generations', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const sql = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

  // RLS on the two tables that hold customer email and spend.
  expect(sql).toMatch(/alter table if exists public\.smart_users\s+enable row level security/i);
  expect(sql).toMatch(/alter table if exists public\.smart_orders enable row level security/i);

  // And the anon grants are taken back.
  for (const t of ['smart_users', 'smart_orders', 'smart_generated_campaigns', 'smart_brain_runs']) {
    expect(sql, `${t} must have its anon grant revoked`).toMatch(new RegExp(`revoke all on public\\.${t}\\s+from anon`, 'i'));
  }
});

test('no table is left writable by anon once every migration has run', () => {
  /* The invariant is the END STATE, not the text. Migrations are append-only:
     a historical `grant ... to anon` line stays in the file forever, and the
     correct fix is a later `revoke`, not a rewrite of applied history. A test
     that greps for the grant alone can therefore never pass, which is how the
     first version of this test failed against a tree that was already fixed. */
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const files = fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort();   // timestamp order

  const granted = new Map();   // table -> migration that granted anon a write
  const revoked = new Set();

  for (const f of files) {
    for (const raw of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      const line = raw.trim();
      if (line.startsWith('--')) continue;

      const g = line.match(/\bgrant\b[^;]*\b(?:insert|update|delete)\b[^;]*\bon\s+(?:public\.)?([%\w."]+)[^;]*\bto\b[^;]*\banon\b/i);
      if (g) granted.set(normalise(g[1], line), f);

      const r = line.match(/\brevoke\b[^;]*\bon\s+(?:public\.)?([%\w."]+)[^;]*\bfrom\b[^;]*\banon\b/i);
      if (r) revoked.add(normalise(r[1], line));
    }
  }

  /* A dynamic `execute format('... on public.%I ...')` cannot name its table on
     that line - it comes from the loop's array. Both the grant and the revoke
     for the compat views are dynamic, so they cancel under the same key. */
  function normalise(ident, line) {
    const t = String(ident).replace(/"/g, '').toLowerCase();
    return t === '%i' ? 'dynamic:' + (/foreach|for\s+\w+\s+in/.test(line) ? 'loop' : 'loop') : t;
  }

  const open = [...granted.entries()].filter(([t]) => !revoked.has(t));
  expect(open.map(([t, f]) => `${t} (granted in ${f}, never revoked)`),
    'these tables are still writable with the published anon key').toEqual([]);
});

/* ═══ 4. No real customer data in the tree ═════════════════════════════════ */

test('tracked CSVs carry no third-party customer email addresses', () => {
  const { execSync } = require('child_process');
  const files = execSync('git ls-files "*.csv"', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const offenders = [];
  for (const f of files) {
    let body;
    try { body = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { continue; }
    const emails = body.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
    // Synthetic fixtures and the brand's OWN sender address are fine; a real
    // person's mailbox is not.
    const real = [...new Set(emails.map((e) => e.toLowerCase()))]
      .filter((e) => !/@example\.(com|org|net)$/.test(e))
      .filter((e) => !/^(hello|support|team|no-?reply|alerts|info)@/.test(e));
    if (real.length) offenders.push(`${f}: ${real.slice(0, 3).join(', ')}${real.length > 3 ? ` (+${real.length - 3})` : ''}`);
  }
  expect(offenders, `real email addresses in tracked CSVs:\n${offenders.join('\n')}`).toEqual([]);
});
