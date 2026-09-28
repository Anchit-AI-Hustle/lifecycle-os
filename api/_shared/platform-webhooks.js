'use strict';
/**
 * platform-webhooks.js — the receiver for platform callbacks.
 * ---------------------------------------------------------------------------
 * NOT a serverless function. Lives under api/_shared/ so it does not count
 * against the Hobby plan's 12-function cap. Routed from api/brain.js
 * ?action=dispatch-webhook&provider=<adapter id>, BEFORE that router reads the
 * request body as data (see the comment at the route).
 *
 * WHY THE ORDER MATTERS. A platform authenticates a callback with a signature
 * over the BYTES it put on the wire. req.body is not those bytes: it is a
 * parse of them, and JSON.stringify of a parse changes whitespace, key order
 * and unicode escapes, none of which survive an HMAC. Until 2026-09-15 the
 * router handed the Meta verifier `JSON.stringify(req.body)`: on a bare stream
 * that was "{}" (the body was never read at all), behind the Vercel helper it
 * was a re-serialisation, so a genuine delivery failed and only a canonical one
 * passed - a verifier that decides on formatting luck rather than on who sent
 * the request. And a GET, Meta's own verification request, went down the same
 * path and was answered with JSON instead of the challenge.
 *
 * WHAT HAPPENS NOW, IN ORDER:
 *   GET   the adapter's verification-request check (Meta: hub.mode=subscribe,
 *         hub.verify_token equal to META_WEBHOOK_VERIFY_TOKEN, hub.challenge),
 *         answered with the challenge as text/plain, or refused with 403.
 *   POST  1. read the bytes that arrived (raw-body.js). Its refusals -
 *            consumed, too_large, no_stream - are refusals here. There is NO
 *            fallback to re-serialising req.body; that is what the module
 *            replaced.
 *         2. hand the bytes and the headers to the adapter's verifyWebhook,
 *            which fails closed with no secret and compares in constant time.
 *         3. only then parse the bytes as JSON.
 *         4. hand the event to dispatch-core.ingestWebhook (record + reconcile).
 *
 * RESPONSE SEMANTICS. A refused POST answers 200 with `processed:false` and a
 * reason, plus one structured log line: Meta retries every non-200 for hours
 * and disables the subscription on persistent failure, so a bad signature must
 * not become a retry storm. Only a failure AFTER verification (the store is
 * down) answers 500, because a retry is exactly right for that. Nothing ever
 * echoes the body.
 * ---------------------------------------------------------------------------
 */

const { readRawBody } = require('./raw-body.js');
const { adapterFor } = require('./adapters/registry.js');
// Called through the module object at call time (dispatch.ingestWebhook), never
// through a destructured binding, so a test can replace it on the cache entry.
const dispatch = require('./dispatch-core.js');

const LOG_AT = 'platform_webhook';

/** One structured line per refusal, for the platform logs. Never the body. */
function logLine(fields) {
  try { console.warn(JSON.stringify(Object.assign({ at: LOG_AT, ts: new Date().toISOString() }, fields))); } catch (_) { /* logging never fails a request */ }
}

function refuse(res, status, provider, reason, note, extra) {
  const out = Object.assign({ ok: false, processed: false, verified: false, provider: provider || null, reason, note }, extra || {});
  logLine({ provider: provider || null, reason, processed: false, verified: out.verified, status, note });
  return res.status(status).json(out);
}

/**
 * The receiver. `req` is the live request with its stream intact; nothing here
 * touches `req.body`.
 */
async function receive(req, res) {
  const q = (req && req.query) || {};
  const provider = String(q.provider || '').toLowerCase();
  const method = String((req && req.method) || 'POST').toUpperCase();
  try {
    const Adapter = adapterFor(provider);
    if (!Adapter) {
      return refuse(res, method === 'GET' ? 404 : 200, provider, 'unknown_provider', `No adapter is registered for "${provider}", so nothing was processed.`);
    }
    const adapter = new Adapter({ workspaceId: '', credentials: {} });

    if (method === 'GET') {
      const c = adapter.verifyChallenge(q);
      if (!c.ok) return refuse(res, 403, provider, c.reason || 'challenge_rejected', c.note);
      logLine({ provider, event: 'verification_request_answered', status: 200 });
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).end(String(c.challenge));
    }
    if (method !== 'POST') {
      return refuse(res, 405, provider, 'method_not_allowed', 'A webhook delivery is a POST; a verification request is a GET.');
    }

    // 1. the bytes that arrived, or a refusal.
    const raw = await readRawBody(req);
    if (!raw.ok) return refuse(res, 200, provider, raw.reason, raw.note);

    // 2. the signature, over those bytes.
    const check = adapter.verifyWebhook((req && req.headers) || {}, raw.bytes);
    if (!check.verified) return refuse(res, 200, provider, check.reason || 'signature_unverified', check.note);

    // 3. only now is the body read as data.
    let event;
    try { event = JSON.parse(raw.bytes.toString('utf8')); } catch (_) { event = undefined; }
    if (!event || typeof event !== 'object') {
      return refuse(res, 200, provider, 'not_json', 'The signature verified but the body is not a JSON object, so there is no event to act on.', { verified: true });
    }

    // 4. the verified event, to the queue.
    const out = await dispatch.ingestWebhook(provider, event, { headers: (req && req.headers) || {}, bytes: raw.bytes, note: check.note });
    return res.status(200).json(Object.assign({ ok: true, processed: true, verified: true, provider }, out || {}));
  } catch (err) {
    logLine({ provider, reason: 'receiver_failed', processed: false, status: 500, error: String((err && err.message) || err).slice(0, 300) });
    return res.status(500).json({ ok: false, processed: false, provider: provider || null, reason: 'receiver_failed' });
  }
}

module.exports = { receive, LOG_AT };
