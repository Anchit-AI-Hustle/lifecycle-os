'use strict';
/**
 * razorpay-credits.js — buy a credit pack with Razorpay (India, INR).
 * ---------------------------------------------------------------------------
 * NOT a serverless function. Lives under api/_shared/ so it does not count
 * against the Hobby plan's 12-function cap; credits-core.js mounts it on
 * /api/public-config?action=credits&op=rzp-order|rzp-verify|rzp-callback|rzp-webhook.
 *
 * Razorpay Standard Checkout with ONE-TIME ORDERS. Subscriptions are not used:
 * a pack is bought once, and Subscriptions is not enabled on the account this
 * was built against (POST /v1/plans answers 401 there).
 *
 * WHAT DECIDES THE MONEY. Only the server. The amount is the pack's price from
 * the same resolver the UI shows (credit_pack_prices, else CREDIT_PACK_PRICES),
 * in paise, and it is offered here only when that price is in INR. A client
 * that sends an amount is ignored: nothing in a request body is read for it.
 *
 * WHEN THE CREDITS LAND. Once, and only after all of these hold:
 *   1. HMAC-SHA256(order_id + "|" + payment_id, RAZORPAY_KEY_SECRET) equals the
 *      signature the checkout returned (compared in constant time);
 *   2. GET /v1/payments/{id} names the same order, the same amount in INR, and
 *      status `captured` (an `authorized` payment is captured first);
 *   3. credit_fulfil_order() wins its pending -> paid compare-and-set. The
 *      checkout's handler, the redirect callback and the webhook can all arrive
 *      for one payment; only the first grants, the rest answer "already".
 * The webhook is the third door: it is trusted on its own signature
 * (RAZORPAY_WEBHOOK_SECRET over the raw body), so a closed tab still credits.
 *
 * WHERE THE RAZORPAY IDS LIVE. No new column: `credit_orders.provider` is
 * 'razorpay' from the moment the order is recorded, and `provider_ref` holds
 * Razorpay's order id while the order is pending and the PAYMENT id once it is
 * paid (credit_fulfil_order writes p_ref over it). A lookup therefore matches
 * either id. 20261024200000_razorpay_payment_once.sql adds a unique index on
 * that column for razorpay rows: one payment id can mark one order paid, ever.
 *
 * WHAT IS NEVER LOGGED OR RETURNED. The key secret and the webhook secret are
 * read here and nowhere else, and never leave the server. Logs carry the
 * provider's status and error code, never a key, a body or a payload.
 * ---------------------------------------------------------------------------
 */
const crypto = require('crypto');
const { readRawBody } = require('./raw-body.js');

const API = 'https://api.razorpay.com/v1';
const ORDER_ID = /^order_[A-Za-z0-9]{6,40}$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]{6,40}$/;
const SIGNATURE = /^[0-9a-f]{64}$/i;

/** Razorpay's minimum order is ₹1, i.e. 100 paise. */
const MIN_AMOUNT = 100;

/** Where the redirect callback sends the page back to. Always this origin. */
const RETURN_PAID = '/credits#paid';
const RETURN_UNPAID = '/credits#unpaid';

const env = (k) => String(process.env[k] || '').trim();
const keyId = () => env('RAZORPAY_KEY_ID');
function ready() { return !!(env('RAZORPAY_KEY_ID') && env('RAZORPAY_KEY_SECRET')); }

function problem(status, error, message) {
  const e = new Error(message);
  e.status = status; e.code = error;
  return e;
}

function hmacHex(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/** Constant time on equal lengths; a length mismatch is simply false. */
function same(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** The checkout signature for an order payment, as Razorpay documents it. */
function checkoutSignatureValid(orderId, paymentId, signature) {
  const secret = env('RAZORPAY_KEY_SECRET');
  if (!secret || !SIGNATURE.test(String(signature || ''))) return false;
  return same(hmacHex(secret, `${orderId}|${paymentId}`), String(signature).toLowerCase());
}

/**
 * One call to Razorpay's REST API with the key pair as Basic auth.
 * A 401 means OUR keys are wrong: that is a deployment fault, said calmly as a
 * 500 with nothing about the keys in it. Anything else the provider refuses is
 * a 502. The log line names the route and the provider's code only.
 */
async function rzp(method, path, route, body) {
  const auth = Buffer.from(`${env('RAZORPAY_KEY_ID')}:${env('RAZORPAY_KEY_SECRET')}`).toString('base64');
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (_) {
    console.error(`[razorpay] ${method} ${route} -> no answer`);
    throw problem(502, 'payment_provider_unreachable', 'The payment service did not answer. Nothing was charged; please try again.');
  }
  const json = await res.json().catch(() => ({}));
  if (res.ok) return json;
  const code = (json && json.error && json.error.code) || 'unknown';
  console.error(`[razorpay] ${method} ${route} -> ${res.status} ${code}`);
  if (res.status === 401) {
    throw problem(500, 'payments_misconfigured', 'Payments are not set up correctly on this deployment. Nothing was charged.');
  }
  throw problem(502, 'payment_provider_error', 'The payment service refused the request. Nothing was charged; please try again.');
}

/** A receipt is at most 40 characters: "lc_" + the order's uuid without dashes is 35. */
function receiptFor(orderUuid) {
  return ('lc_' + String(orderUuid).replace(/-/g, '')).slice(0, 40);
}

/* ── the purchase record ──────────────────────────────────────────────────── */

/** The razorpay order row whose provider_ref is this order id or this payment id. */
async function findPurchase(d, orderId, paymentId) {
  if (ORDER_ID.test(orderId)) {
    const rows = await d.serviceRest(`credit_orders?select=*&provider=eq.razorpay&provider_ref=eq.${orderId}&limit=1`);
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  if (PAYMENT_ID.test(paymentId)) {
    const rows = await d.serviceRest(`credit_orders?select=*&provider=eq.razorpay&provider_ref=eq.${paymentId}&limit=1`);
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  return null;
}

/* ── create the order ─────────────────────────────────────────────────────── */

async function startOrder(auth, { pack_key, workspace_id }, d) {
  if (!ready()) {
    throw problem(503, 'razorpay_unconfigured', 'Paying with Razorpay is not set up on this deployment yet. Nothing was charged.');
  }
  const p = d.catalog.pack(pack_key);
  if (!p) throw problem(400, 'unknown_pack', 'Unknown credit pack.');
  // The amount comes from the price list and from nowhere else.
  const price = d.catalog.packPrice(p.key, await d.packOverrides());
  if (!price.configured) {
    throw problem(409, 'pack_unpriced', `The ${p.label} pack has no price set on this deployment, so it cannot be bought. ${price.marker}`);
  }
  if (price.currency !== 'INR') {
    throw problem(409, 'razorpay_currency', `The ${p.label} pack is priced in ${price.currency}, and Razorpay here takes rupees only. Nothing was charged.`);
  }
  const amount = Number(price.amount_minor);
  if (!Number.isInteger(amount) || amount < MIN_AMOUNT) {
    throw problem(409, 'razorpay_amount', `The ${p.label} pack's price is below Razorpay's minimum of ₹1, so it cannot be paid here.`);
  }
  const credits = p.credits + (p.bonus || 0);
  // A phone account's orders are personal, exactly as createOrder() records them.
  const ws = auth && auth.provider === 'mobile-pin' ? null : (workspace_id || null);
  const w = await d.wallet(auth.user_id, ws);

  const rows = await d.serviceRest('credit_orders?select=*', {
    method: 'POST',
    body: [{
      user_id: auth.user_id, workspace_id: ws, pack_key: p.key, credits,
      status: 'pending', amount_minor: amount, currency: 'INR', provider: 'razorpay',
    }],
    prefer: 'return=representation',
  });
  const row = Array.isArray(rows) ? rows[0] : rows;

  let order;
  try {
    order = await rzp('POST', '/orders', 'orders.create', {
      amount, currency: 'INR', receipt: receiptFor(row.id),
      notes: { wallet: String(w && w.id || ''), pack: p.key, credits: String(credits), credit_order: String(row.id) },
    });
  } catch (e) {
    // Nothing was created at Razorpay, so this purchase can never be paid.
    await d.serviceRest(`credit_orders?id=eq.${row.id}&status=eq.pending`, {
      method: 'PATCH', body: { status: 'failed', updated_at: new Date().toISOString() },
    }).catch(() => {});
    throw e;
  }
  if (!order || !ORDER_ID.test(String(order.id || '')) || Number(order.amount) !== amount || order.currency !== 'INR') {
    console.error('[razorpay] POST orders.create -> unexpected order shape');
    throw problem(502, 'payment_provider_error', 'The payment service answered with an order this app did not ask for. Nothing was charged.');
  }
  await d.serviceRest(`credit_orders?id=eq.${row.id}&status=eq.pending`, {
    method: 'PATCH', body: { provider_ref: order.id, updated_at: new Date().toISOString() },
  });

  return {
    ok: true, provider: 'razorpay',
    keyId: keyId(), orderId: order.id, amount, currency: 'INR',
    pack: { key: p.key, label: p.label, credits },
    credit_order_id: row.id,
    prefill: auth.email ? { email: auth.email } : {},
  };
}

/* ── confirm a payment ────────────────────────────────────────────────────── */

/**
 * The checks every door runs once it has a purchase row, an order id and a
 * payment id, then the one grant. `payment` may be handed in by the webhook
 * (already signed by Razorpay); otherwise it is read from the API.
 */
async function settle(d, row, orderId, paymentId, payment) {
  const want = Number(row.amount_minor);
  let pay = payment || await rzp('GET', `/payments/${paymentId}`, 'payments.fetch');
  if (!pay || pay.id !== paymentId || pay.order_id !== orderId) {
    throw problem(400, 'payment_other_order', 'That payment belongs to a different order. No credits were added.');
  }
  if (Number(pay.amount) !== want || String(pay.currency || '').toUpperCase() !== 'INR') {
    throw problem(400, 'payment_amount_mismatch', 'That payment is not for this pack\'s amount. No credits were added.');
  }
  if (pay.status === 'authorized' && !payment) {
    pay = await rzp('POST', `/payments/${paymentId}/capture`, 'payments.capture', { amount: want, currency: 'INR' });
  }
  if (!pay || pay.status !== 'captured') {
    throw problem(400, 'payment_not_captured', 'That payment has not been completed. No credits were added.');
  }
  const out = await d.fulfilOrder(row.id, { provider: 'razorpay', provider_ref: paymentId });
  let balance = out.balance;
  if (!out.credited || balance == null) {
    const w = await d.wallet(row.user_id, row.workspace_id || null).catch(() => null);
    balance = w ? w.balance : null;
  }
  return {
    ok: true, provider: 'razorpay', credited: !!out.credited,
    credits: out.credited ? out.credits : 0,
    balance: balance == null ? null : Number(balance),
    order: { id: row.id, status: 'paid', pack_key: row.pack_key },
    message: out.credited ? `Added ${row.credits} credits.` : 'This payment was already counted. Nothing more was added.',
  };
}

function proofFrom(body) {
  const b = body || {};
  return {
    orderId: String(b.razorpay_order_id || '').trim(),
    paymentId: String(b.razorpay_payment_id || '').trim(),
    signature: String(b.razorpay_signature || '').trim(),
  };
}

/** The checkout handler's POST, from a signed-in page. */
async function verify(auth, body, d) {
  if (!ready()) throw problem(503, 'razorpay_unconfigured', 'Paying with Razorpay is not set up on this deployment.');
  const { orderId, paymentId, signature } = proofFrom(body);
  if (!orderId || !paymentId || !signature) {
    throw problem(400, 'payment_incomplete', 'The payment details are incomplete. No credits were added.');
  }
  if (!ORDER_ID.test(orderId) || !PAYMENT_ID.test(paymentId) || !checkoutSignatureValid(orderId, paymentId, signature)) {
    throw problem(400, 'payment_unverified', 'The payment could not be confirmed. No credits were added.');
  }
  const row = await findPurchase(d, orderId, paymentId);
  // Someone else's order answers exactly like no order: nothing about it is said.
  if (!row || row.user_id !== auth.user_id) {
    throw problem(400, 'payment_other_order', 'That payment belongs to a different order. No credits were added.');
  }
  return settle(d, row, orderId, paymentId);
}

/**
 * Razorpay's redirect mode posts the result here as a form (phones and in-app
 * browsers block the bank page's popup, so the whole page goes through the bank
 * and comes back). No session rides along, so the order id finds the purchase
 * and the signature proves the payment. Answers where the page goes next.
 */
async function callback(form, d) {
  const f = form || {};
  if (f.error || f['error[code]'] || f['error[description]']) return RETURN_UNPAID;
  const { orderId, paymentId, signature } = proofFrom(f);
  if (!ORDER_ID.test(orderId) || !PAYMENT_ID.test(paymentId) || !checkoutSignatureValid(orderId, paymentId, signature)) return RETURN_UNPAID;
  try {
    const row = await findPurchase(d, orderId, paymentId);
    if (!row) return RETURN_UNPAID;
    await settle(d, row, orderId, paymentId);
    return RETURN_PAID;
  } catch (_) {
    return RETURN_UNPAID;
  }
}

/** Razorpay's webhook. The signature covers the raw body bytes. */
async function webhook(rawBytes, headers, d) {
  const secret = env('RAZORPAY_WEBHOOK_SECRET');
  if (!secret) throw problem(503, 'webhook_unconfigured', 'RAZORPAY_WEBHOOK_SECRET is not set on this deployment.');
  const sent = String((headers && (headers['x-razorpay-signature'] || headers['X-Razorpay-Signature'])) || '').trim().toLowerCase();
  if (!SIGNATURE.test(sent) || !same(hmacHex(secret, rawBytes), sent)) {
    throw problem(400, 'webhook_signature_mismatch', 'Signature did not match.');
  }
  let ev;
  try { ev = JSON.parse(Buffer.isBuffer(rawBytes) ? rawBytes.toString('utf8') : String(rawBytes)); }
  catch (_) { throw problem(400, 'webhook_body_unreadable', 'The webhook body is not JSON.'); }

  const event = String(ev && ev.event || '');
  if (event !== 'order.paid' && event !== 'payment.captured') return { ok: true, ignored: event || 'unknown' };
  const pay = ev.payload && ev.payload.payment && ev.payload.payment.entity;
  const ord = ev.payload && ev.payload.order && ev.payload.order.entity;
  const paymentId = String(pay && pay.id || '');
  const orderId = String((pay && pay.order_id) || (ord && ord.id) || '');
  if (!ORDER_ID.test(orderId) || !PAYMENT_ID.test(paymentId)) return { ok: true, ignored: 'no_order_payment' };

  const row = await findPurchase(d, orderId, paymentId);
  // Another app on the same Razorpay account, or an order this app never made.
  if (!row) return { ok: true, ignored: 'unknown_order' };
  try {
    const out = await settle(d, row, orderId, paymentId, pay);
    return { ok: true, event, credited: out.credited };
  } catch (e) {
    // A signed event that does not match the purchase is not retried into a
    // different answer: record nothing, tell Razorpay it was received.
    if (e.status === 400) return { ok: true, event, credited: false, refused: e.code };
    throw e;
  }
}

/* ── the router's half ────────────────────────────────────────────────────── */

/** Form bodies: Vercel parses urlencoded; a bare stream is parsed here. */
async function formOf(req) {
  if (req && req.body && typeof req.body === 'object' && Object.keys(req.body).length) return req.body;
  if (req && typeof req.body === 'string' && req.body) return Object.fromEntries(new URLSearchParams(req.body));
  const raw = await readRawBody(req);
  return raw.ok ? Object.fromEntries(new URLSearchParams(raw.bytes.toString('utf8'))) : {};
}

/** The two doors no session comes through: the redirect callback and the webhook. */
async function handleOpen(op, req, res, d) {
  if (op === 'rzp-callback') {
    if (req.method && req.method !== 'POST') { res.setHeader('Location', RETURN_UNPAID); return res.status(303).end(); }
    const where = await callback(await formOf(req), d).catch(() => RETURN_UNPAID);
    res.setHeader('Location', where);
    return res.status(303).end();
  }
  if (op === 'rzp-webhook') {
    if (req.method && req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const raw = await readRawBody(req);
    if (!raw.ok) return res.status(400).json({ ok: false, error: 'webhook_body_unreadable' });
    try {
      return res.status(200).json(await webhook(raw.bytes, req.headers || {}, d));
    } catch (e) {
      return res.status(e.status || 500).json({ ok: false, error: e.code || 'webhook_failed', message: e.status ? e.message : undefined });
    }
  }
  return null;
}

/** The two doors a signed-in page comes through. */
async function handleSignedIn(op, auth, body, workspaceId, res, d) {
  if (op === 'rzp-order') return res.status(200).json(await startOrder(auth, { pack_key: body.pack_key, workspace_id: workspaceId }, d));
  if (op === 'rzp-verify') return res.status(200).json(await verify(auth, body, d));
  return null;
}

/** Errors leave as a status, a code and a sentence; a 500 says nothing more. */
function sendError(res, e) {
  if (e && e.status && e.code) return res.status(e.status).json({ ok: false, error: e.code, message: e.message });
  return res.status(500).json({ ok: false, error: 'payment_failed', message: 'The payment could not be processed. Nothing was charged.' });
}

module.exports = {
  ready, keyId, handleOpen, handleSignedIn, sendError,
  startOrder, verify, callback, webhook, settle, checkoutSignatureValid, receiptFor,
  RETURN_PAID, RETURN_UNPAID, MIN_AMOUNT,
};
