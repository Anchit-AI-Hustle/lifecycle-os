// Meta webhook signature verification: api/brain.js ?action=dispatch-webhook,
// over api/_shared/raw-body.js, through the SHIPPED entry point.
//
// Every test here drives the real router (api/brain.js with its request-scope
// wrapper) over a real socket on a real http.Server, with a real HMAC computed
// in this file under the same secret. Nothing asserts on source text.
//
// What is stubbed, and why it intercepts. dispatch-core.js exports an OBJECT
// (`module.exports = { enqueue, ..., ingestWebhook }`) and the receiver calls
// `dispatch.ingestWebhook(...)` through that object at call time, so replacing
// the property on the require.cache entry is seen by the shipped code. That is
// NOT true of a module that exports the function itself (llm.js does
// `module.exports = async function callLLM`, and a `.callLLM` property stub
// there replaces a key that does not exist) - which is why the harness asserts
// the stub was REACHED on the valid case rather than assuming it. global.fetch
// is replaced with one that throws, so no store or provider call can escape.
//
// The properties, and why each earns a test:
//
//   - The raw BYTES are what is signed. Vercel hands a handler req.body already
//     parsed, and JSON.stringify of that is a different byte string from the
//     one Meta signed. The router is driven three ways: a bare Node stream; a
//     request whose stream the Vercel helper has drained and RESTORED (its
//     restoreBody replica, mirrored below line for line from @vercel/node
//     13.0.1, with the same lazy req.body parser); and a request whose stream
//     was drained and NOT restored, where the only acceptable answer is a
//     refusal - never a signature checked against reconstructed JSON. That
//     last case carries a CANONICAL body on purpose: a fallback to
//     JSON.stringify(req.body) would accept it, and only a refusal proves the
//     fallback is absent.
//   - The action is routed BEFORE the body is read as data. req.body is a
//     counting getter in every mode, and the webhook path must never touch it:
//     behind the Vercel helper the getter throws 400 on a non-JSON body, so a
//     router that read req.body before verifying would hand Meta a 400 (and a
//     retry) for a body it had not yet decided to trust.
//   - Fail closed. With no META_APP_SECRET a correctly signed delivery is
//     refused; verification is never skipped.
//   - Meta's response semantics. A refusal is 200 with nothing processed and a
//     structured log line, because Meta retries non-200s and disables the
//     subscription on persistent failure. The GET verification request is
//     answered with the challenge as text/plain, only for the configured token.
//   - Constant-time compare, observed by spying on crypto.timingSafeEqual,
//     because === and timingSafeEqual return the same booleans and only the
//     call itself tells them apart. A wrong-length signature must be a clean
//     mismatch, not the throw timingSafeEqual would produce.
//
// Run: npx playwright test tests/meta-webhook-raw-body.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const http = require('http');
const crypto = require('crypto');
const { PassThrough } = require('stream');

const BRAIN = require.resolve('../api/brain.js');
const DISPATCH = require.resolve('../api/_shared/dispatch-core.js');

const SECRET = 'meta_app_secret_' + crypto.randomBytes(16).toString('hex');
const OTHER_SECRET = 'meta_other_' + crypto.randomBytes(16).toString('hex');
const VERIFY_TOKEN = 'verify_' + crypto.randomBytes(12).toString('hex');

// Deliberately NOT what JSON.stringify would produce: two-space indentation,
// newlines, a space after each colon, and a unicode ESCAPE where JSON.stringify
// would emit the character itself. Three of the ways a re-serialisation
// diverges from the bytes on the wire, in one body.
const PRETTY = [
  '{',
  '  "object": "page",',
  '  "entry": [',
  '    {',
  '      "id": "1234567890",',
  '      "time": 1700000000,',
  '      "changes": [',
  '        {',
  '          "field": "feed",',
  '          "value": { "item": "status", "verb": "add", "message": "caf\\u00e9 drop" }',
  '        }',
  '      ]',
  '    }',
  '  ]',
  '}',
].join('\n');
const CANONICAL = JSON.stringify(JSON.parse(PRETTY));

/** The documented scheme, computed here independently of the module. */
function sign(secret, raw) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

/* ── environment ────────────────────────────────────────────────────────── */

const ENV_KEYS = ['META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'VERCEL_ENV'];
const SAVED = {};
const REAL_FETCH = global.fetch;
test.beforeAll(() => {
  for (const k of ENV_KEYS) { SAVED[k] = process.env[k]; delete process.env[k]; }
  process.env.META_APP_SECRET = SECRET;
  process.env.META_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
  // Nothing leaves this process. A store write or a provider call that escaped
  // the gate would throw here and surface as a 500 in the test, not as a
  // silent success.
  global.fetch = async (url) => { throw new Error(`network call escaped the webhook gate: ${url}`); };
});
test.afterAll(() => {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k];
  }
  global.fetch = REAL_FETCH;
});

/* ── the stub, and proof that it intercepts ─────────────────────────────── */

const reached = [];
let realIngest = null;
test.beforeEach(() => {
  reached.length = 0;
  require(BRAIN);
  // The router requires dispatch-core LAZILY, inside the action, so it is not
  // in the cache yet. Loading it here by its resolved path puts the one entry
  // the router will later resolve into the cache, and the stub goes on that.
  require(DISPATCH);
  const mod = require.cache[DISPATCH];
  expect(mod && mod.exports && typeof mod.exports.ingestWebhook, 'dispatch-core must be in require.cache with ingestWebhook').toBe('function');
  realIngest = mod.exports.ingestWebhook;
  mod.exports.ingestWebhook = async (provider, event, meta) => {
    reached.push({ provider, event, bytes: meta && meta.bytes, headers: meta && meta.headers });
    return { stored: true, jobs_updated: 0 };
  };
});
test.afterEach(() => {
  const mod = require.cache[DISPATCH];
  if (mod && realIngest) mod.exports.ingestWebhook = realIngest;
});

/* ── the harness: what Vercel does to a request before a handler runs ───── */

/**
 * Mirrored from @vercel/node 13.0.1 serverless-functions/helpers.ts: the stream
 * is read to a Buffer, req.body becomes a LAZY parse of it (which throws a 400
 * ApiError on invalid JSON), and restoreBody() rebinds on/addListener for
 * 'data'/'end' (and read) to a replica of the original bytes.
 */
async function drain(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
function restoreBody(req, bytes) {
  const replicateBody = new PassThrough();
  const on = replicateBody.on.bind(replicateBody);
  const originalOn = req.on.bind(req);
  req.read = replicateBody.read.bind(replicateBody);
  req.on = req.addListener = (name, cb) => (name === 'data' || name === 'end' ? on(name, cb) : originalOn(name, cb));
  replicateBody.write(bytes);
  replicateBody.end();
}
function vercelBodyParser(bytes, contentType) {
  return () => {
    const type = String(contentType || '').split(';')[0].trim();
    if (!type) return undefined;
    if (type === 'application/json') {
      try { const s = bytes.toString(); return s ? JSON.parse(s) : {}; }
      catch (_) { const e = new Error('Invalid JSON'); e.statusCode = 400; throw e; }
    }
    if (type === 'text/plain') return bytes.toString();
    return undefined;
  };
}

/**
 * A real http.Server whose handler applies the Vercel shape to the REAL
 * request and response objects, then calls the shipped api/brain.js.
 * `x-mode`: bare (a plain Node stream, as under vercel dev), vercel (drained
 * and restored, as in production), drained (drained and NOT restored).
 * Every request records how many times the handler read req.body.
 */
function serve() {
  const stats = [];
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      const stat = { mode: req.headers['x-mode'] || 'bare', bodyReads: 0 };
      stats.push(stat);
      const q = {};
      new URL(req.url, 'http://x').searchParams.forEach((v, k) => { q[k] = v; });
      req.query = q;
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (j) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(j)); };
      res.send = (x) => { res.end(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)); };
      const counted = (parse) => Object.defineProperty(req, 'body', { configurable: true, get() { stat.bodyReads += 1; return parse(); } });
      try {
        if (stat.mode === 'bare') {
          counted(() => undefined);
        } else {
          const bytes = await drain(req);
          counted(vercelBodyParser(bytes, req.headers['content-type']));
          if (stat.mode === 'vercel') restoreBody(req, bytes);
        }
        await require(BRAIN)(req, res);
      } catch (e) {
        // What @vercel/node does with an ApiError thrown out of the handler.
        res.statusCode = (e && e.statusCode) || 500;
        res.end(JSON.stringify({ harness_error: String((e && e.message) || e) }));
      }
    });
    srv.stats = stats;
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
function request(port, { method = 'POST', path: p, raw, headers }) {
  return new Promise((resolve, reject) => {
    const h = Object.assign(raw != null ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) } : {}, headers || {});
    const req = http.request({ hostname: '127.0.0.1', port, path: p, method, headers: h }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let out = null;
        try { out = data ? JSON.parse(data) : null; } catch (_) { out = null; }
        resolve({ status: res.statusCode, headers: res.headers, text: data, out });
      });
    });
    req.on('error', reject);
    if (raw != null) req.end(raw); else req.end();
  });
}
const HOOK = '/api/brain?action=dispatch-webhook&provider=meta';

/** Structured refusal lines the receiver writes, captured for one call. */
async function withWarnLines(fn) {
  const lines = [];
  const real = console.warn;
  console.warn = (...args) => { for (const a of args) { try { const j = JSON.parse(String(a)); if (j && j.at === 'platform_webhook') lines.push(j); } catch (_) { /* not ours */ } } };
  try { return [await fn(), lines]; } finally { console.warn = real; }
}

/* ── 1. a valid signature over the exact bytes ──────────────────────────── */

for (const mode of ['bare', 'vercel']) {
  test(`[${mode}] a delivery signed over the bytes that arrived is verified, parsed from those bytes, and handed to the dispatch handler`, async () => {
    const srv = await serve();
    try {
      const r = await request(srv.address().port, { path: HOOK, raw: PRETTY, headers: { 'x-hub-signature-256': sign(SECRET, PRETTY), 'x-mode': mode } });
      expect(r.status).toBe(200);
      expect(r.out).toMatchObject({ ok: true, processed: true, verified: true, provider: 'meta' });
      expect(r.out.reason).toBeUndefined();

      // The handler was REACHED - the stub is only trusted because it fired.
      expect(reached.length).toBe(1);
      expect(reached[0].provider).toBe('meta');
      // ...with the event parsed from the bytes, unicode escape resolved.
      expect(reached[0].event).toEqual(JSON.parse(PRETTY));
      expect(reached[0].event.entry[0].changes[0].value.message).toBe('café drop');
      // ...and with the bytes themselves, byte for byte.
      expect(Buffer.isBuffer(reached[0].bytes)).toBe(true);
      expect(reached[0].bytes.toString('utf8')).toBe(PRETTY);

      // req.body was never read. Behind the helper JSON.stringify(req.body)
      // would be CANONICAL, whose HMAC differs, so a router that re-serialised
      // would have refused this delivery; a router that merely READ req.body
      // before verifying is the 400-on-non-JSON defect tested below.
      expect(srv.stats[0].mode).toBe(mode);
      expect(srv.stats[0].bodyReads).toBe(0);
      expect(CANONICAL).not.toBe(PRETTY);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });
}

/* ── 2. a tampered body, a wrong secret, a missing header ───────────────── */

test('one byte changed after signing is refused with 200, nothing processed, and the handler is not reached', async () => {
  const srv = await serve();
  try {
    const header = sign(SECRET, PRETTY);
    const tampered = Buffer.from(PRETTY);
    const at = PRETTY.indexOf('1234567890') + 3;   // the '4' of the entry id -> '5'
    tampered[at] = '5'.charCodeAt(0);
    expect(tampered.toString()).not.toBe(PRETTY);
    for (const mode of ['bare', 'vercel']) {
      const [r, lines] = await withWarnLines(() => request(srv.address().port, { path: HOOK, raw: tampered, headers: { 'x-hub-signature-256': header, 'x-mode': mode } }));
      expect(r.status, mode).toBe(200);
      expect(r.out, mode).toMatchObject({ ok: false, processed: false, verified: false, provider: 'meta', reason: 'signature_mismatch' });
      // The body is never echoed, verified or not.
      expect(r.text, mode).not.toContain('1234567890');
      expect(r.text, mode).not.toContain('1235567890');
      // A structured log line names the refusal.
      expect(lines.length, mode).toBe(1);
      expect(lines[0]).toMatchObject({ at: 'platform_webhook', provider: 'meta', reason: 'signature_mismatch', processed: false });
    }
    expect(reached.length).toBe(0);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('a signature under a different secret, and a delivery with no signature header, are refused without reaching the handler', async () => {
  const srv = await serve();
  try {
    const port = srv.address().port;
    const wrong = await request(port, { path: HOOK, raw: PRETTY, headers: { 'x-hub-signature-256': sign(OTHER_SECRET, PRETTY), 'x-mode': 'vercel' } });
    expect(wrong.status).toBe(200);
    expect(wrong.out).toMatchObject({ processed: false, verified: false, reason: 'signature_mismatch' });

    const none = await request(port, { path: HOOK, raw: PRETTY, headers: { 'x-mode': 'vercel' } });
    expect(none.status).toBe(200);
    expect(none.out).toMatchObject({ processed: false, verified: false, reason: 'signature_header_missing' });

    // A header without the sha256= scheme is a missing signature, not a match attempt.
    const scheme = await request(port, { path: HOOK, raw: PRETTY, headers: { 'x-hub-signature-256': sign(SECRET, PRETTY).replace('sha256=', 'sha1='), 'x-mode': 'vercel' } });
    expect(scheme.out).toMatchObject({ processed: false, reason: 'signature_header_missing' });

    expect(reached.length).toBe(0);
    for (const s of srv.stats) expect(s.bodyReads).toBe(0);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

/* ── 3. a body that is already consumed ─────────────────────────────────── */

test('a drained stream is refused as consumed even when re-serialising req.body WOULD have matched the signature', async () => {
  const srv = await serve();
  try {
    // CANONICAL bytes, correctly signed. In `drained` mode req.body is the
    // parsed object and JSON.stringify(req.body) reproduces these bytes
    // EXACTLY, so a receiver that fell back to re-serialising would verify
    // TRUE and process. The only honest answer is that the bytes were not read.
    expect(JSON.stringify(JSON.parse(CANONICAL))).toBe(CANONICAL);
    const [r, lines] = await withWarnLines(() => request(srv.address().port, { path: HOOK, raw: CANONICAL, headers: { 'x-hub-signature-256': sign(SECRET, CANONICAL), 'x-mode': 'drained' } }));
    expect(r.status).toBe(200);
    expect(r.out).toMatchObject({ ok: false, processed: false, verified: false, provider: 'meta', reason: 'consumed' });
    expect(lines.length).toBe(1);
    expect(lines[0].reason).toBe('consumed');
    expect(reached.length).toBe(0);
    expect(srv.stats[0].bodyReads).toBe(0);

    // The same delivery, the same bytes, on a restored stream: verified. So the
    // refusal above is about the stream, not the body.
    const ok = await request(srv.address().port, { path: HOOK, raw: CANONICAL, headers: { 'x-hub-signature-256': sign(SECRET, CANONICAL), 'x-mode': 'vercel' } });
    expect(ok.out).toMatchObject({ processed: true, verified: true });
    expect(reached.length).toBe(1);
    expect(reached[0].bytes.toString()).toBe(CANONICAL);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

/* ── 4. fail closed with no secret ──────────────────────────────────────── */

test('with no META_APP_SECRET a correctly signed delivery is refused, never verified as true', async () => {
  const srv = await serve();
  try {
    const port = srv.address().port;
    const header = sign(SECRET, PRETTY);
    for (const value of [undefined, '', '   ']) {
      if (value === undefined) delete process.env.META_APP_SECRET; else process.env.META_APP_SECRET = value;
      try {
        const [r, lines] = await withWarnLines(() => request(port, { path: HOOK, raw: PRETTY, headers: { 'x-hub-signature-256': header, 'x-mode': 'vercel' } }));
        expect(r.status, JSON.stringify(value)).toBe(200);
        expect(r.out, JSON.stringify(value)).toMatchObject({ ok: false, processed: false, verified: false, reason: 'secret_missing' });
        expect(r.out.note, JSON.stringify(value)).toContain('META_APP_SECRET');
        expect(lines.length, JSON.stringify(value)).toBe(1);
        expect(lines[0].reason).toBe('secret_missing');
      } finally {
        process.env.META_APP_SECRET = SECRET;
      }
    }
    expect(reached.length).toBe(0);
    // With the secret back, the same delivery is processed.
    const ok = await request(port, { path: HOOK, raw: PRETTY, headers: { 'x-hub-signature-256': header, 'x-mode': 'vercel' } });
    expect(ok.out.processed).toBe(true);
    expect(reached.length).toBe(1);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

/* ── 5. the action runs BEFORE the body is read as data ─────────────────── */

test('a signed body that is not JSON is refused with 200, and the Vercel body parser is never invoked', async () => {
  const srv = await serve();
  try {
    // Behind the helper, req.body is a lazy parser that throws a 400 on invalid
    // JSON. A router that touched req.body before routing this action would
    // answer Meta with that 400 - a retry - for a body it had not verified.
    const raw = 'this is not json';
    const [r, lines] = await withWarnLines(() => request(srv.address().port, { path: HOOK, raw, headers: { 'x-hub-signature-256': sign(SECRET, raw), 'x-mode': 'vercel' } }));
    expect(r.status).toBe(200);
    expect(r.out).toMatchObject({ ok: false, processed: false, verified: true, reason: 'not_json' });
    expect(lines.length).toBe(1);
    expect(lines[0].reason).toBe('not_json');
    expect(srv.stats[0].bodyReads).toBe(0);
    expect(reached.length).toBe(0);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

/* ── 6. Meta's GET verification request ─────────────────────────────────── */

test('the GET verification request is answered with the challenge as text, only for the configured verify token', async () => {
  const srv = await serve();
  try {
    const port = srv.address().port;
    const challenge = '1158201444';
    const url = (token) => `${HOOK}&hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=${challenge}`;

    const ok = await request(port, { method: 'GET', path: url(VERIFY_TOKEN) });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe(challenge);
    expect(String(ok.headers['content-type'])).toMatch(/^text\/plain/);

    const wrong = await request(port, { method: 'GET', path: url(VERIFY_TOKEN + 'x') });
    expect(wrong.status).toBe(403);
    expect(wrong.text).not.toContain(challenge);
    expect(wrong.out).toMatchObject({ ok: false, processed: false, reason: 'verify_token_mismatch' });

    const mode = await request(port, { method: 'GET', path: url(VERIFY_TOKEN).replace('hub.mode=subscribe', 'hub.mode=unsubscribe') });
    expect(mode.status).toBe(403);
    expect(mode.text).not.toContain(challenge);

    delete process.env.META_WEBHOOK_VERIFY_TOKEN;
    try {
      const unset = await request(port, { method: 'GET', path: url(VERIFY_TOKEN) });
      expect(unset.status).toBe(403);
      expect(unset.text).not.toContain(challenge);
      expect(unset.out).toMatchObject({ reason: 'verify_token_missing' });
      expect(unset.out.note).toContain('META_WEBHOOK_VERIFY_TOKEN');
    } finally {
      process.env.META_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
    }

    // A GET is never a delivery: nothing reached the handler, nothing read a body.
    expect(reached.length).toBe(0);
    for (const s of srv.stats) expect(s.bodyReads).toBe(0);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

/* ── 7. constant-time compare ───────────────────────────────────────────── */

test('signatures are compared in constant time, and a wrong-length one is a mismatch, not a throw', async () => {
  const cryptoMod = require('crypto');
  const real = cryptoMod.timingSafeEqual;
  const calls = [];
  cryptoMod.timingSafeEqual = function spied(a, b) {
    calls.push([a.length, b.length]);
    return real.call(cryptoMod, a, b);
  };
  const srv = await serve();
  try {
    const port = srv.address().port;
    // An equal-length wrong signature goes through timingSafeEqual: 'sha256='
    // plus 64 hex characters on both sides.
    const wrong = 'sha256=' + 'f'.repeat(64);
    const r1 = await request(port, { path: HOOK, raw: PRETTY, headers: { 'x-hub-signature-256': wrong, 'x-mode': 'vercel' } });
    expect(r1.status).toBe(200);
    expect(r1.out).toMatchObject({ processed: false, reason: 'signature_mismatch' });
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual([71, 71]);

    // A signature of the wrong length is never handed to timingSafeEqual,
    // which would throw on it; it is simply not a match, and still a 200.
    calls.length = 0;
    const r2 = await request(port, { path: HOOK, raw: PRETTY, headers: { 'x-hub-signature-256': 'sha256=abc', 'x-mode': 'vercel' } });
    expect(r2.status).toBe(200);
    expect(r2.out).toMatchObject({ processed: false, reason: 'signature_mismatch' });
    expect(calls.length).toBe(0);

    // The genuine one is compared the same way and passes.
    calls.length = 0;
    const r3 = await request(port, { path: HOOK, raw: PRETTY, headers: { 'x-hub-signature-256': sign(SECRET, PRETTY), 'x-mode': 'vercel' } });
    expect(r3.out.processed).toBe(true);
    expect(calls.length).toBe(1);
    expect(reached.length).toBe(1);
  } finally {
    cryptoMod.timingSafeEqual = real;
    await new Promise((r) => srv.close(r));
  }
});

/* ── 8. other providers, and a POST with no provider ────────────────────── */

test('an unknown provider and a provider with no signature scheme are refused, not accepted unverified', async () => {
  const srv = await serve();
  try {
    const port = srv.address().port;
    const unknown = await request(port, { path: '/api/brain?action=dispatch-webhook&provider=nope', raw: PRETTY, headers: { 'x-hub-signature-256': sign(SECRET, PRETTY), 'x-mode': 'vercel' } });
    expect(unknown.status).toBe(200);
    expect(unknown.out).toMatchObject({ ok: false, processed: false, verified: false, reason: 'unknown_provider' });

    // Klaviyo's scheme is not wired; its adapter says so and the receiver
    // refuses rather than storing an unverified event as if it were one.
    const klaviyo = await request(port, { path: '/api/brain?action=dispatch-webhook&provider=klaviyo', raw: PRETTY, headers: { 'x-mode': 'vercel' } });
    expect(klaviyo.status).toBe(200);
    expect(klaviyo.out).toMatchObject({ ok: false, processed: false, verified: false, provider: 'klaviyo', reason: 'no_signature_scheme' });

    // A method that is neither a delivery nor a verification request.
    const put = await request(port, { method: 'PUT', path: HOOK, raw: PRETTY, headers: { 'x-hub-signature-256': sign(SECRET, PRETTY), 'x-mode': 'vercel' } });
    expect(put.status).toBe(405);
    expect(put.out).toMatchObject({ ok: false, processed: false, reason: 'method_not_allowed' });

    expect(reached.length).toBe(0);
    for (const s of srv.stats) expect(s.bodyReads).toBe(0);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
