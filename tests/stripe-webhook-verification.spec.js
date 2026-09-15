// Stripe webhook signature verification: api/_shared/payments-core.js
// verifyStripeWebhook() and the ?op=webhook receiver, over api/_shared/raw-body.js.
//
// Every test here EXECUTES the verifier or the receiver with real inputs and a
// real HMAC computed in this file under the same secret. Nothing asserts on
// source text. The properties, and why each earns a test:
//
//   - The raw BYTES are what is signed. Vercel hands a handler req.body already
//     parsed, and JSON.stringify of that is a different byte string from the
//     one Stripe signed. The receiver is driven three ways through the real
//     router: a bare Node stream; a request whose stream the Vercel helper has
//     drained and RESTORED (its restoreBody replica, mirrored below line for
//     line from @vercel/node 13.0.1); and a request whose stream was drained
//     and NOT restored, where the only acceptable answer is a refusal - never a
//     signature checked against reconstructed JSON. That last case carries a
//     CANONICAL body on purpose: a fallback to JSON.stringify(req.body) would
//     accept it, and only a refusal proves the fallback is absent.
//   - Fail closed. With no STRIPE_WEBHOOK_SECRET a correctly signed delivery is
//     refused; verification is never skipped.
//   - Constant-time compare, observed by spying on crypto.timingSafeEqual,
//     because === and timingSafeEqual return the same booleans and only the
//     call itself tells them apart. An odd-length signature must be a clean
//     mismatch, not the throw timingSafeEqual would produce.
//
// Run: npx playwright test tests/stripe-webhook-verification.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const http = require('http');
const crypto = require('crypto');
const { PassThrough } = require('stream');

const core = require('../api/_shared/payments-core.js');
const { readRawBody } = require('../api/_shared/raw-body.js');

const SECRET = 'whsec_test_' + crypto.randomBytes(16).toString('hex');
const OTHER_SECRET = 'whsec_other_' + crypto.randomBytes(16).toString('hex');

// Deliberately NOT what JSON.stringify would produce: two-space indentation,
// newlines, a space after each colon. Stripe's own bodies are pretty-printed.
const PRETTY = '{\n  "id": "evt_test_1",\n  "object": "event",\n  "type": "account.updated",\n  "account": "acct_A",\n  "livemode": false,\n  "created": 1700000000\n}';
const CANONICAL = JSON.stringify(JSON.parse(PRETTY));

/** The documented scheme, computed here independently of the module. */
function sign(secret, t, raw) {
  return crypto.createHmac('sha256', secret).update(`${t}.` + raw).digest('hex');
}
function headerFor(t, ...sigs) {
  return `t=${t},` + sigs.map((s) => `v1=${s}`).join(',');
}
function nowSec() { return Math.floor(Date.now() / 1000); }

const SAVED = {};
test.beforeAll(() => {
  SAVED.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  SAVED.PAYMENTS_PUBLIC_BASE_URL = process.env.PAYMENTS_PUBLIC_BASE_URL;
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.PAYMENTS_PUBLIC_BASE_URL = 'https://payments.test';
});
test.afterAll(() => {
  for (const k of Object.keys(SAVED)) {
    if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k];
  }
});

/* ── 1. the verifier ─────────────────────────────────────────────────────── */

test('a delivery signed with the configured secret verifies and returns the event', () => {
  const t = nowSec();
  const r = core.verifyStripeWebhook({ header: headerFor(t, sign(SECRET, t, PRETTY)), rawBody: Buffer.from(PRETTY) });
  expect(r.ok).toBe(true);
  expect(r.verified).toBe(true);
  expect(r.error).toBeUndefined();
  expect(r.timestamp).toBe(t);
  expect(r.signatures_checked).toBe(1);
  expect(r.event.id).toBe('evt_test_1');
  expect(r.event.type).toBe('account.updated');
  // A string body is accepted too, and yields the same verdict as the Buffer.
  const s = core.verifyStripeWebhook({ header: headerFor(t, sign(SECRET, t, PRETTY)), rawBody: PRETTY });
  expect(s.ok).toBe(true);
});

test('a signature under a different secret is refused, and the event is withheld', () => {
  const t = nowSec();
  const r = core.verifyStripeWebhook({ header: headerFor(t, sign(OTHER_SECRET, t, PRETTY)), rawBody: PRETTY });
  expect(r.ok).toBe(false);
  expect(r.verified).toBe(false);
  expect(r.error).toBe('stripe_signature_mismatch');
  expect(r.event).toBeUndefined();
  // The explicit parameter is honoured the same way as the env var.
  const e = core.verifyStripeWebhook({ header: headerFor(t, sign(SECRET, t, PRETTY)), rawBody: PRETTY, secret: OTHER_SECRET });
  expect(e.error).toBe('stripe_signature_mismatch');
});

test('changing one byte of the body invalidates the signature', () => {
  const t = nowSec();
  const header = headerFor(t, sign(SECRET, t, PRETTY));
  expect(core.verifyStripeWebhook({ header, rawBody: PRETTY }).ok).toBe(true);
  const tampered = Buffer.from(PRETTY);
  const at = PRETTY.indexOf('acct_A') + 5;   // the 'A' of acct_A -> 'B'
  tampered[at] = 'B'.charCodeAt(0);
  const r = core.verifyStripeWebhook({ header, rawBody: tampered });
  expect(r.ok).toBe(false);
  expect(r.error).toBe('stripe_signature_mismatch');
  expect(r.event).toBeUndefined();
});

test('the same JSON re-serialised with different whitespace is refused, so the raw bytes are what is signed', () => {
  const t = nowSec();
  // Signed over the pretty body, verified against its compact re-serialisation.
  const prettySigned = headerFor(t, sign(SECRET, t, PRETTY));
  expect(core.verifyStripeWebhook({ header: prettySigned, rawBody: CANONICAL }).error).toBe('stripe_signature_mismatch');
  // And the reverse: signed compact, handed the pretty bytes.
  const compactSigned = headerFor(t, sign(SECRET, t, CANONICAL));
  expect(core.verifyStripeWebhook({ header: compactSigned, rawBody: PRETTY }).error).toBe('stripe_signature_mismatch');
  // Each verifies only against the bytes it was signed over.
  expect(core.verifyStripeWebhook({ header: prettySigned, rawBody: PRETTY }).ok).toBe(true);
  expect(core.verifyStripeWebhook({ header: compactSigned, rawBody: CANONICAL }).ok).toBe(true);
});

test('a timestamp older than the tolerance is refused as a replay, and one inside it is accepted', () => {
  const now = 1_800_000_000;
  const at = (t, extra) => core.verifyStripeWebhook(Object.assign({ header: headerFor(t, sign(SECRET, t, PRETTY)), rawBody: PRETTY, now }, extra || {}));

  // Default tolerance is 300 seconds: 301 out, 299 in, exactly 300 in.
  expect(at(now - 301).error).toBe('stripe_signature_timestamp_outside_tolerance');
  expect(at(now - 301).event).toBeUndefined();
  expect(at(now - 299).ok).toBe(true);
  expect(at(now - 300).ok).toBe(true);
  expect(core.STRIPE_WEBHOOK_TOLERANCE_SEC).toBe(300);

  // The tolerance is a parameter: widened, the same stale delivery passes;
  // narrowed, a fresh one fails.
  expect(at(now - 400, { toleranceSec: 600 }).ok).toBe(true);
  expect(at(now - 30, { toleranceSec: 10 }).error).toBe('stripe_signature_timestamp_outside_tolerance');

  // Without a pinned clock the real one is used, and a fresh delivery passes.
  const live = nowSec();
  expect(core.verifyStripeWebhook({ header: headerFor(live, sign(SECRET, live, PRETTY)), rawBody: PRETTY }).ok).toBe(true);
  const stale = nowSec() - 600;
  expect(core.verifyStripeWebhook({ header: headerFor(stale, sign(SECRET, stale, PRETTY)), rawBody: PRETTY }).error)
    .toBe('stripe_signature_timestamp_outside_tolerance');
});

test('a timestamp beyond the tolerance in the FUTURE is refused too', () => {
  const now = 1_800_000_000;
  const t = now + 301;
  const r = core.verifyStripeWebhook({ header: headerFor(t, sign(SECRET, t, PRETTY)), rawBody: PRETTY, now });
  expect(r.error).toBe('stripe_signature_timestamp_outside_tolerance');
  const near = now + 60;
  expect(core.verifyStripeWebhook({ header: headerFor(near, sign(SECRET, near, PRETTY)), rawBody: PRETTY, now }).ok).toBe(true);
});

test('several v1 signatures: any one matching is enough, and unknown schemes are ignored', () => {
  const t = nowSec();
  const good = sign(SECRET, t, PRETTY);
  const stale = sign(OTHER_SECRET, t, PRETTY);   // the previous secret during a roll

  // Only the SECOND entry matches.
  const second = core.verifyStripeWebhook({ header: headerFor(t, stale, good), rawBody: PRETTY });
  expect(second.ok).toBe(true);
  expect(second.signatures_checked).toBe(2);

  // Only the first, then only the third.
  expect(core.verifyStripeWebhook({ header: headerFor(t, good, stale), rawBody: PRETTY }).ok).toBe(true);
  expect(core.verifyStripeWebhook({ header: headerFor(t, stale, stale, good), rawBody: PRETTY }).ok).toBe(true);

  // None matching is a mismatch, not a partial credit.
  expect(core.verifyStripeWebhook({ header: headerFor(t, stale, stale), rawBody: PRETTY }).error).toBe('stripe_signature_mismatch');

  // v0 and any other prefix are discarded; a matching v1 beside them still verifies.
  const withV0 = `t=${t},v0=${'0'.repeat(64)},v1=${good},v9=whatever`;
  expect(core.verifyStripeWebhook({ header: withV0, rawBody: PRETTY }).ok).toBe(true);
  // A matching digest under the WRONG scheme name does not count.
  expect(core.verifyStripeWebhook({ header: `t=${t},v0=${good}`, rawBody: PRETTY }).error).toBe('stripe_signature_header_malformed');
});

test('a missing header is refused before any comparison', () => {
  for (const header of [undefined, null, '', '   ']) {
    const r = core.verifyStripeWebhook({ header, rawBody: PRETTY });
    expect(r.ok, String(header)).toBe(false);
    expect(r.error, String(header)).toBe('stripe_signature_header_missing');
    expect(r.event).toBeUndefined();
  }
});

test('a malformed header is refused', () => {
  const t = nowSec();
  const good = sign(SECRET, t, PRETTY);
  const cases = [
    ['garbage', 'no key=value elements at all'],
    [`v1=${good}`, 'no t= timestamp'],
    [`t=${t}`, 'no v1= signature'],
    [`t=,v1=${good}`, 'empty timestamp'],
    [`t=notanumber,v1=${good}`, 'non-numeric timestamp'],
    [`t=${t},v1=`, 'empty signature'],
    [`t=${t};v1=${good}`, 'wrong separator'],
  ];
  for (const [header, why] of cases) {
    const r = core.verifyStripeWebhook({ header, rawBody: PRETTY });
    expect(r.ok, why).toBe(false);
    expect(r.error, why).toBe('stripe_signature_header_malformed');
    expect(r.event, why).toBeUndefined();
  }
  // The parser itself, on its own.
  expect(core.parseStripeSignatureHeader(`t=${t},v0=x,v1=${good},v1=abc`)).toEqual({ ok: true, timestampText: String(t), timestamp: t, signatures: [good, 'abc'] });
  expect(core.parseStripeSignatureHeader('t=1,x').ok).toBe(false);
});

test('with no STRIPE_WEBHOOK_SECRET configured a correctly signed delivery is still refused', () => {
  const t = nowSec();
  const header = headerFor(t, sign(SECRET, t, PRETTY));
  expect(core.verifyStripeWebhook({ header, rawBody: PRETTY }).ok).toBe(true);

  delete process.env.STRIPE_WEBHOOK_SECRET;
  try {
    const r = core.verifyStripeWebhook({ header, rawBody: PRETTY });
    expect(r.ok).toBe(false);
    expect(r.verified).toBe(false);
    expect(r.error).toBe('stripe_webhook_secret_missing');
    expect(r.event).toBeUndefined();
    // Blank counts as unset, whether from the environment or the parameter.
    process.env.STRIPE_WEBHOOK_SECRET = '   ';
    expect(core.verifyStripeWebhook({ header, rawBody: PRETTY }).error).toBe('stripe_webhook_secret_missing');
    expect(core.verifyStripeWebhook({ header, rawBody: PRETTY, secret: '' }).error).toBe('stripe_webhook_secret_missing');
  } finally {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  }
});

test('a body that is not available as bytes is refused, never reconstructed', () => {
  const t = nowSec();
  const header = headerFor(t, sign(SECRET, t, CANONICAL));
  // A parsed object is exactly what Vercel's req.body is. The verifier must
  // not stringify it - that would pass here, because CANONICAL is what
  // JSON.stringify produces.
  for (const rawBody of [undefined, null, JSON.parse(CANONICAL), 42]) {
    const r = core.verifyStripeWebhook({ header, rawBody });
    expect(r.ok, String(rawBody)).toBe(false);
    expect(r.error, String(rawBody)).toBe('raw_body_unavailable');
  }
});

test('signatures are compared in constant time, and an odd-length one is a mismatch, not a throw', () => {
  const t = nowSec();
  const cryptoMod = require('crypto');
  const real = cryptoMod.timingSafeEqual;
  const calls = [];
  cryptoMod.timingSafeEqual = function spied(a, b) {
    calls.push([a.length, b.length]);
    return real.call(cryptoMod, a, b);
  };
  try {
    // An equal-length wrong signature goes through timingSafeEqual.
    const wrong = 'f'.repeat(64);
    const r1 = core.verifyStripeWebhook({ header: headerFor(t, wrong), rawBody: PRETTY });
    expect(r1.ok).toBe(false);
    expect(r1.error).toBe('stripe_signature_mismatch');
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual([64, 64]);

    // Every candidate is compared, a match does not stop the loop.
    calls.length = 0;
    const good = sign(SECRET, t, PRETTY);
    expect(core.verifyStripeWebhook({ header: headerFor(t, good, wrong), rawBody: PRETTY }).ok).toBe(true);
    expect(calls.length).toBe(2);

    // A signature of the wrong length is never handed to timingSafeEqual,
    // which would throw on it; it is simply not a match.
    calls.length = 0;
    const r2 = core.verifyStripeWebhook({ header: headerFor(t, 'abc'), rawBody: PRETTY });
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe('stripe_signature_mismatch');
    expect(calls.length).toBe(0);
  } finally {
    cryptoMod.timingSafeEqual = real;
  }
});

test('a verified body that is not JSON yields no event to act on', () => {
  const t = nowSec();
  const raw = 'not json at all';
  const r = core.verifyStripeWebhook({ header: headerFor(t, sign(SECRET, t, raw)), rawBody: raw });
  expect(r.ok).toBe(false);
  expect(r.verified).toBe(true);
  expect(r.error).toBe('stripe_event_not_json');
  expect(r.event).toBeUndefined();
});

/* ── 2. the raw body reader ─────────────────────────────────────────────── */

/**
 * What @vercel/node's request helper does to a request before a handler
 * runs, mirrored from serverless-functions/helpers.ts in 13.0.1: the stream
 * is read to a Buffer, req.body becomes a lazy parse of it, and restoreBody()
 * rebinds on/addListener for 'data'/'end' (and read) to a replica.
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
function vercelHelper(req, bytes) {
  Object.defineProperty(req, 'body', { configurable: true, get() { return JSON.parse(bytes.toString()); } });
  restoreBody(req, bytes);
}

/** A real http.Server; `mode` decides what happens to the stream before the reader sees it. */
function serve(onRequest) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => { Promise.resolve(onRequest(req, res)).catch((e) => { res.writeHead(500); res.end(String(e && e.message)); }); });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
function post(port, path, raw, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) }, headers || {}) }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (_) { parsed = { raw: data }; }
        resolve({ status: res.statusCode, out: parsed });
      });
    });
    req.on('error', reject);
    req.end(raw);
  });
}

test('the reader returns the bytes from a bare stream and from the Vercel replica, and refuses a drained one', async () => {
  const seen = {};
  const srv = await serve(async (req, res) => {
    const mode = req.headers['x-mode'];
    if (mode === 'vercel') vercelHelper(req, await drain(req));
    if (mode === 'drained') { const b = await drain(req); Object.defineProperty(req, 'body', { configurable: true, get() { return JSON.parse(b.toString()); } }); }
    seen[mode] = await readRawBody(req);
    res.writeHead(200); res.end('ok');
  });
  try {
    const port = srv.address().port;
    await post(port, '/', PRETTY, { 'x-mode': 'bare' });
    await post(port, '/', PRETTY, { 'x-mode': 'vercel' });
    await post(port, '/', PRETTY, { 'x-mode': 'drained' });
  } finally {
    await new Promise((r) => srv.close(r));
  }
  expect(seen.bare.ok).toBe(true);
  expect(seen.bare.bytes.toString()).toBe(PRETTY);
  expect(seen.vercel.ok).toBe(true);
  expect(seen.vercel.bytes.toString()).toBe(PRETTY);
  expect(seen.drained.ok).toBe(false);
  expect(seen.drained.reason).toBe('consumed');

  // No stream at all, and an oversized body, are refusals with a reason.
  expect((await readRawBody({})).reason).toBe('no_stream');
  expect((await readRawBody(null)).reason).toBe('no_request');
  const big = new PassThrough();
  const pending = readRawBody(big, { maxBytes: 10 });
  big.write(Buffer.alloc(11)); big.end();
  expect((await pending).reason).toBe('too_large');
  // A runtime that already captured the bytes under the conventional name.
  expect((await readRawBody({ rawBody: Buffer.from('x') })).bytes.toString()).toBe('x');
});

/* ── 3. the receiver, through the real router ───────────────────────────── */

/** The router the way api/public-config.js invokes it, on a live request. */
function routerServer() {
  return serve(async (req, res) => {
    const mode = req.headers['x-mode'] || 'bare';
    const q = {};
    new URL(req.url, 'http://x').searchParams.forEach((v, k) => { q[k] = v; });
    req.query = q;
    const shim = {
      statusCode: 200,
      setHeader() {}, removeHeader() {},
      status(c) { this.statusCode = c; return this; },
      json(j) { res.writeHead(this.statusCode, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); },
      end() { res.writeHead(this.statusCode); res.end(); },
    };
    if (mode === 'vercel') vercelHelper(req, await drain(req));
    if (mode === 'drained') { const b = await drain(req); Object.defineProperty(req, 'body', { configurable: true, get() { return JSON.parse(b.toString()); } }); }
    await core.handle(req, shim);
  });
}

const HOOK = '/api/public-config?action=payments&op=webhook&gateway=stripe';

test('the receiver verifies a delivery over the raw bytes on a bare stream', async () => {
  const srv = await routerServer();
  try {
    const t = nowSec();
    const r = await post(srv.address().port, HOOK, PRETTY, { 'stripe-signature': headerFor(t, sign(SECRET, t, PRETTY)), 'x-mode': 'bare' });
    expect(r.status).toBe(200);
    expect(r.out.ok).toBe(true);
    expect(r.out.verified).toBe(true);
    expect(r.out.gateway).toBe('stripe');
    expect(r.out.event).toEqual({ id: 'evt_test_1', type: 'account.updated', account: 'acct_A', livemode: false, created: 1700000000 });
    expect(r.out.applied).toBe(false);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('the receiver verifies the pretty-printed bytes behind the Vercel helper, where req.body is already parsed', async () => {
  const srv = await routerServer();
  try {
    const t = nowSec();
    // Signed over PRETTY. JSON.stringify(req.body) would be CANONICAL, whose
    // HMAC differs, so a receiver that re-serialised would refuse this.
    const r = await post(srv.address().port, HOOK, PRETTY, { 'stripe-signature': headerFor(t, sign(SECRET, t, PRETTY)), 'x-mode': 'vercel' });
    expect(r.status).toBe(200);
    expect(r.out.verified).toBe(true);
    expect(r.out.event.id).toBe('evt_test_1');
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('the receiver refuses a drained stream even when re-serialising req.body WOULD have matched', async () => {
  const srv = await routerServer();
  try {
    const t = nowSec();
    // CANONICAL bytes, correctly signed. A fallback to JSON.stringify(req.body)
    // reproduces these bytes exactly and would answer 200. The only honest
    // answer is that the bytes were not read.
    const r = await post(srv.address().port, HOOK, CANONICAL, { 'stripe-signature': headerFor(t, sign(SECRET, t, CANONICAL)), 'x-mode': 'drained' });
    expect(r.status).toBe(500);
    expect(r.out.ok).toBe(false);
    expect(r.out.verified).toBe(false);
    expect(r.out.error).toBe('raw_body_unavailable');
    expect(r.out.reason).toBe('consumed');
    expect(r.out.event).toBeUndefined();
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('the receiver answers 400 on a bad signature, 503 with no secret, and never echoes the body', async () => {
  const srv = await routerServer();
  try {
    const port = srv.address().port;
    const t = nowSec();
    const bad = await post(port, HOOK, PRETTY, { 'stripe-signature': headerFor(t, sign(OTHER_SECRET, t, PRETTY)) });
    expect(bad.status).toBe(400);
    expect(bad.out.ok).toBe(false);
    expect(bad.out.error).toBe('stripe_signature_mismatch');
    expect(JSON.stringify(bad.out)).not.toContain('evt_test_1');

    const none = await post(port, HOOK, PRETTY, {});
    expect(none.status).toBe(400);
    expect(none.out.error).toBe('stripe_signature_header_missing');

    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      const closed = await post(port, HOOK, PRETTY, { 'stripe-signature': headerFor(t, sign(SECRET, t, PRETTY)) });
      expect(closed.status).toBe(503);
      expect(closed.out.ok).toBe(false);
      expect(closed.out.verified).toBe(false);
      expect(closed.out.error).toBe('stripe_webhook_secret_missing');
      expect(closed.out.event).toBeUndefined();
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    }

    // An unparseable body never reaches req.body: the receiver is routed
    // before the router reads it, and a verified non-JSON body is not an event.
    const notJson = 'this is not json';
    const nj = await post(port, HOOK, notJson, { 'stripe-signature': headerFor(t, sign(SECRET, t, notJson)) });
    expect(nj.status).toBe(400);
    expect(nj.out.error).toBe('stripe_event_not_json');
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('every other gateway is refused with 501 rather than accepted unverified, and a GET is not a delivery', async () => {
  const srv = await routerServer();
  try {
    const port = srv.address().port;
    for (const gw of ['razorpay', 'paypal', 'shopify_payments']) {
      const r = await post(port, `/api/public-config?action=payments&op=webhook&gateway=${gw}`, PRETTY, {});
      expect(r.status, gw).toBe(501);
      expect(r.out.ok, gw).toBe(false);
      expect(r.out.verified, gw).toBe(false);
      expect(r.out.error, gw).toBe('webhook_verification_not_implemented');
    }
    const unknown = await post(port, '/api/public-config?action=payments&op=webhook&gateway=nope', PRETTY, {});
    expect(unknown.status).toBe(400);
    expect(unknown.out.error).toBe('unknown_gateway');
  } finally {
    await new Promise((r) => srv.close(r));
  }

  // Method check, through the same shim the other payments tests use.
  const got = await new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, removeHeader() {}, status(c) { this.statusCode = c; return this; }, json(j) { resolve({ status: this.statusCode, out: j }); }, end() { resolve({ status: this.statusCode, out: null }); } };
    core.handle({ method: 'GET', headers: {}, query: { action: 'payments', op: 'webhook', gateway: 'stripe' } }, res);
  });
  expect(got.status).toBe(405);
});

/* ── 4. the reference no longer says the scheme is unknown ──────────────── */

test('the registry states the scheme and the receiver reports what it verifies', async () => {
  const stripe = core.gateway('stripe');
  expect(stripe.webhooks.verification).not.toContain('DATA REQUIRED');
  expect(stripe.webhooks.verification).toContain('STRIPE_WEBHOOK_SECRET');
  expect(Object.keys(stripe.platform_prereq.env)).toContain('STRIPE_WEBHOOK_SECRET');

  const readiness = core.platformReadiness();
  expect(readiness.stripe.webhooks.ready).toBe(true);
  delete process.env.STRIPE_WEBHOOK_SECRET;
  try {
    expect(core.platformReadiness().stripe.webhooks).toEqual({ ready: false, missing: ['STRIPE_WEBHOOK_SECRET'] });
  } finally {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  }

  const got = await new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, removeHeader() {}, status(c) { this.statusCode = c; return this; }, json(j) { resolve({ status: this.statusCode, out: j }); }, end() { resolve({ status: this.statusCode, out: null }); } };
    core.handle({ method: 'POST', headers: {}, query: { action: 'payments', op: 'webhooks' }, body: {} }, res);
  });
  expect(got.status).toBe(200);
  expect(got.out.receiver.verifies).toEqual(['stripe']);
  expect(got.out.receiver.refuses.sort()).toEqual(['paypal', 'razorpay', 'shopify_payments']);
  expect(got.out.receiver.applies_state_changes).toBe(false);
  expect(got.out.endpoint).toContain('/api/payments?op=webhook');
  expect(got.out.gateways.find((g) => g.id === 'stripe').receiver).toBe('verified');
  expect(got.out.gateways.find((g) => g.id === 'paypal').receiver).toBe('refused');
  // The secret itself is nowhere in the reference.
  expect(JSON.stringify(got.out)).not.toContain(SECRET);
});
