'use strict';
/**
 * raw-body.js — the request body as the BYTES that arrived.
 * ---------------------------------------------------------------------------
 * NOT a serverless function. Lives under api/_shared/ so it does not count
 * against the Hobby plan's 12-function cap.
 *
 * WHY THIS EXISTS. A webhook signature is an HMAC over the request body exactly
 * as the sender put it on the wire. Vercel's Node runtime reads the body before
 * a handler runs and hands it over PARSED on `req.body`, and JSON.stringify of
 * that object is a different byte string from the one that was signed:
 * whitespace, key order and unicode escapes all change, and none of them
 * survive an HMAC. A verifier fed a re-serialisation passes or fails on
 * formatting luck rather than on who sent the request.
 *
 * WHO READS THROUGH IT. Two receivers, and they must stay the only two paths a
 * signed body takes: payments-core.js's Stripe receiver
 * (public-config.js ?action=payments&op=webhook, Stripe-Signature) and
 * platform-webhooks.js behind api/brain.js ?action=dispatch-webhook (Meta's
 * X-Hub-Signature-256). Until 2026-09-15 the latter handed its verifier
 * `JSON.stringify(req.body)` - "{}" on a bare stream, a re-serialisation
 * behind the helper - which is exactly the defect described above.
 *
 * HOW THE BYTES ARE STILL THERE. @vercel/node's request helper - the code that
 * populates req.body / req.query and adds res.status / res.json - reads the
 * whole stream and then RESTORES it: `restoreBody()` in
 * serverless-functions/helpers.ts rebinds `req.on` / `req.addListener` for the
 * 'data' and 'end' events (and `req.read`) to a PassThrough that replays the
 * original bytes. Read 2026-09-15 in @vercel/node 13.0.1's shipped bundle
 * (dist/dev-server.mjs, the same helpers source `vercel dev` runs; the
 * production Lambda receives the same behaviour under its shouldAddHelpers
 * flag). So after the helper the LISTENER API still yields the raw body; the
 * async iterator and pipe() do not, because they hook methods the helper leaves
 * pointing at the drained original. This module therefore reads through
 * on('data') and on('end') and nothing else - the one API that works both on a
 * bare Node stream (vercel dev, a plain http.Server, the test harness) and
 * behind the helper.
 *
 * FAIL CLOSED. When the stream was drained and NOT restored there is nothing to
 * read, and this says so. It never falls back to re-serialising req.body.
 * ---------------------------------------------------------------------------
 */

/** Stripe events and Meta change notifications are a few KB; 1 MiB is generous. */
const DEFAULT_MAX_BYTES = 1024 * 1024;
/** On a serverless runtime the body is fully present before invocation. */
const DEFAULT_TIMEOUT_MS = 10000;

function refuse(reason, note) {
  return { ok: false, reason, note };
}

/**
 * Read the request body as it arrived.
 *
 * @param {import('http').IncomingMessage} req
 * @param {{maxBytes?:number, timeoutMs?:number}} [opts]
 * @returns {Promise<{ok:true, bytes:Buffer}|{ok:false, reason:string, note:string}>}
 *   `reason` is one of: no_request, no_stream, consumed, too_large, timeout,
 *   stream_error. Every refusal is a reason to refuse the webhook, never a
 *   reason to reconstruct a body from req.body.
 */
function readRawBody(req, { maxBytes = DEFAULT_MAX_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    if (!req) return resolve(refuse('no_request', 'No request object was handed to the raw-body reader.'));

    // A runtime that already captured the bytes under the conventional name.
    if (Buffer.isBuffer(req.rawBody)) return resolve({ ok: true, bytes: req.rawBody });
    if (typeof req.rawBody === 'string') return resolve({ ok: true, bytes: Buffer.from(req.rawBody, 'utf8') });

    if (typeof req.on !== 'function') {
      return resolve(refuse('no_stream', 'The request carries no readable stream, so its body bytes cannot be read.'));
    }

    // Drained and not restored. The helper installs its replica as an OWN
    // property named `on`; a prototype `on` on a stream that has already
    // emitted 'end' means the bytes are gone and nothing will ever arrive.
    // `readableEnded` (not `complete`): a small request can be fully received
    // and buffered before a listener attaches, and that is still readable.
    const restored = Object.prototype.hasOwnProperty.call(req, 'on');
    if (req.readableEnded === true && !restored) {
      return resolve(refuse('consumed', 'The request stream was already consumed and not restored, so the body bytes that were signed are not available. A signature cannot be checked against a re-serialisation of req.body.'));
    }

    const chunks = [];
    let total = 0;
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => finish(refuse('timeout', `The request body did not finish arriving within ${timeoutMs}ms.`)), timeoutMs);

    req.on('error', (e) => finish(refuse('stream_error', `The request stream failed: ${(e && e.message) || e}.`)));
    req.on('data', (chunk) => {
      if (done) return;
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += b.length;
      if (total > maxBytes) return finish(refuse('too_large', `The request body exceeds ${maxBytes} bytes.`));
      chunks.push(b);
    });
    req.on('end', () => finish({ ok: true, bytes: Buffer.concat(chunks) }));
  });
}

module.exports = { readRawBody, DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS };
