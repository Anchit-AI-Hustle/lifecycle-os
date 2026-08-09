'use strict';
/**
 * credits-core.js — the platform's credit meter.
 * ---------------------------------------------------------------------------
 * Every feature that spends a model call goes through `meter()`. The flow is
 * always the same three beats, so a failure can never burn a user's credits:
 *
 *     const m = await credits.meter(req, 'mailer.generate', { units: 1 });
 *     if (!m.ok) return res.status(402).json(m);      // 402 = out of credits
 *     try   { const out = await doTheWork(); await m.settle(actualUnits);
 *             return res.json({ ...out, credits: m.receipt }); }
 *     catch (e) { await m.release(); throw e; }
 *
 * Prices come from credit-catalog.js (versioned, shown in the UI) with optional
 * per-feature overrides from the `credit_prices` table.
 *
 * Security: the balance-moving SQL functions are SECURITY DEFINER and are
 * REVOKEd from anon/authenticated (see the migration), so they are only ever
 * reachable through this module — which verifies the caller's Supabase JWT
 * first and then calls them with the service role. A browser cannot grant
 * itself credits or cancel its own charge.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * Routed from api/public-config.js ?action=credits.
 * ---------------------------------------------------------------------------
 */

const catalog = require('./credit-catalog.js');
const brandCore = require('./brand-workspace-core.js');

function env() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url) throw new Error('SUPABASE_URL missing');
  if (!service) {
    const e = new Error('SUPABASE_SERVICE_ROLE_KEY missing — the credit meter cannot move a balance without it.');
    e.status = 503; e.code = 'credits_unavailable';
    throw e;
  }
  return { url: String(url).replace(/\/$/, ''), service };
}

/** Is the meter usable at all? Lets callers degrade honestly instead of 500ing. */
function configured() {
  try { env(); return true; } catch (_) { return false; }
}

async function rpc(fn, args) {
  const e = env();
  const res = await fetch(`${e.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: e.service, authorization: `Bearer ${e.service}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
    cache: 'no-store',
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) {
    const err = new Error(`credits rpc ${fn} -> ${res.status}: ${(json && (json.message || json.hint)) || text}`);
    err.status = 502;
    throw err;
  }
  return json;
}

async function serviceRest(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const e = env();
  const headers = { apikey: e.service, authorization: `Bearer ${e.service}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) { const err = new Error(`credits ${method} ${pathAndQuery} -> ${res.status}: ${text}`); err.status = 502; throw err; }
  return json;
}

/* ── price overrides ──────────────────────────────────────────────────────── */

let OVERRIDES = null, OVERRIDES_AT = 0;
const OVERRIDE_TTL = 60_000;

async function overrides() {
  if (OVERRIDES && Date.now() - OVERRIDES_AT < OVERRIDE_TTL) return OVERRIDES;
  try {
    const rows = await serviceRest('credit_prices?select=feature_key,cost,unit_label');
    const map = Object.create(null);
    for (const r of Array.isArray(rows) ? rows : []) map[r.feature_key] = r;
    OVERRIDES = map; OVERRIDES_AT = Date.now();
  } catch (_) { OVERRIDES = OVERRIDES || Object.create(null); OVERRIDES_AT = Date.now(); }
  return OVERRIDES;
}

/** The price list the UI renders, with any operator override already applied. */
async function priceList() {
  const ov = await overrides();
  return catalog.list().map((f) => {
    const q = catalog.quote(f.key, f.estimate, ov);
    return { key: f.key, label: f.label, group: f.group, cost: q.cost, unit: q.unit, metered: q.metered, estimate: f.estimate, why: f.why, overridden: !!ov[f.key] };
  });
}

/* ── wallet reads ─────────────────────────────────────────────────────────── */

async function wallet(userId, workspaceId) {
  const q = workspaceId
    ? `credit_wallets?select=*&user_id=eq.${encodeURIComponent(userId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`
    : `credit_wallets?select=*&user_id=eq.${encodeURIComponent(userId)}&workspace_id=is.null&limit=1`;
  const rows = await serviceRest(q);
  if (Array.isArray(rows) && rows[0]) return rows[0];

  // First touch: create the wallet and drop the welcome grant in, once.
  const id = await rpc('credit_wallet_id', { p_user: userId, p_workspace: workspaceId || null });
  const grant = catalog.welcomeGrant();
  if (grant > 0) {
    const seen = await serviceRest(`credit_ledger?select=id&wallet_id=eq.${encodeURIComponent(id)}&kind=eq.grant&limit=1`);
    if (!Array.isArray(seen) || !seen.length) {
      await rpc('credit_grant', {
        p_user: userId, p_workspace: workspaceId || null, p_amount: grant,
        p_kind: 'grant', p_ref: 'welcome', p_note: 'Welcome credits', p_meta: { source: 'welcome_grant' },
      });
    }
  }
  const again = await serviceRest(q);
  return (Array.isArray(again) && again[0]) || { id, user_id: userId, workspace_id: workspaceId || null, balance: 0, held: 0 };
}

async function ledger(userId, workspaceId, limit = 50) {
  const lim = Math.max(1, Math.min(500, +limit || 50));
  let q = `credit_ledger?select=id,kind,feature_key,feature_label,units,unit_label,delta,balance_after,ref,note,created_at&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${lim}`;
  if (workspaceId) q += `&workspace_id=eq.${encodeURIComponent(workspaceId)}`;
  const rows = await serviceRest(q);
  return Array.isArray(rows) ? rows : [];
}

async function usage(userId, workspaceId, days = 30) {
  const rows = await rpc('credit_usage', { p_user: userId, p_workspace: workspaceId || null, p_days: Math.max(1, +days || 30) });
  return Array.isArray(rows) ? rows : [];
}

/* ── the meter ────────────────────────────────────────────────────────────── */

/**
 * Reserve credits for one run of `featureKey`.
 *
 * Resolves { ok:true, hold_id, quote, balance, settle(), release(), receipt }
 * or   { ok:false, error:'insufficient_credits', balance, required, short_by }.
 *
 * A zero-cost feature short-circuits: no hold, no ledger row, settle/release
 * are no-ops — free features stay free and stay fast.
 */
async function meter(req, featureKey, opts) {
  const o = opts || {};
  const ov = await overrides();
  const q = catalog.quote(featureKey, o.units, ov);

  if (q.unknown) {
    const e = new Error(`Unknown feature key "${featureKey}" — it must be declared in credit-catalog.js before it can run.`);
    e.status = 500; e.code = 'unpriced_feature';
    throw e;
  }

  const workspaceId = o.workspace_id || (req && req.query && req.query.workspace_id) || (req && req.body && req.body.workspace_id) || null;

  // A free feature costs nothing, so it takes no hold, writes no ledger row and
  // does not pay for a session round-trip. Checked BEFORE auth so a free
  // feature can never be blocked by the meter being unreachable.
  if (q.total <= 0) {
    return {
      ok: true, free: true, hold_id: null, quote: q, charged: 0, workspace_id: workspaceId,
      auth: o.auth || null,
      receipt: { feature: q.key, label: q.label, cost: 0, unit: q.unit, charged: 0 },
      settle: async () => ({ ok: true, charged: 0 }),
      release: async () => ({ ok: true, released: 0 }),
    };
  }

  const auth = o.auth || await brandCore.requireUser(req);
  if (!auth.ok) return Object.assign({ ok: false }, auth);

  // If the meter is not configured we must not hand out paid features for
  // free silently — say so, with a 503 the UI can explain.
  if (!configured()) {
    return { ok: false, status: 503, error: 'credits_unavailable', message: 'The credit meter is not configured on this deployment (SUPABASE_SERVICE_ROLE_KEY missing), so paid features are disabled.', quote: q };
  }

  await wallet(auth.user_id, workspaceId);   // ensures wallet + welcome grant

  const held = await rpc('credit_hold', {
    p_user: auth.user_id, p_workspace: workspaceId, p_amount: q.total,
    p_feature: q.key, p_label: q.label, p_unit_label: q.unit, p_units: q.units,
    p_ref: o.ref || null, p_meta: o.meta || {},
  });

  if (!held || held.ok !== true) {
    return Object.assign({ ok: false, status: 402, error: 'insufficient_credits', quote: q, feature: q.key, label: q.label }, held || {});
  }

  const holdId = held.hold_id;
  let done = false;

  return {
    ok: true,
    free: false,
    hold_id: holdId,
    quote: q,
    balance: held.balance,
    auth,
    workspace_id: workspaceId,

    /** Charge the real usage. `actualUnits` only matters for metered features. */
    async settle(actualUnits, extra) {
      if (done) return { ok: true, already: true };
      done = true;
      const units = q.metered && Number(actualUnits) > 0 ? Math.max(1, Math.ceil(Number(actualUnits))) : q.units;
      const actual = q.cost * units;
      const r = await rpc('credit_settle', {
        p_hold: holdId, p_actual: actual, p_units: units,
        p_ref: (extra && extra.ref) || o.ref || null, p_meta: (extra && extra.meta) || o.meta || {},
      });
      this.receipt = {
        feature: q.key, label: q.label, cost: q.cost, unit: q.unit,
        units, charged: (r && r.charged) || actual, refunded: (r && r.refunded) || 0,
        balance: r && r.balance,
      };
      this.balance = r && r.balance;
      return r;
    },

    /** Give the whole reservation back — use on any failure path. */
    async release(note) {
      if (done) return { ok: true, already: true };
      done = true;
      try { return await rpc('credit_release', { p_hold: holdId, p_note: note || null }); }
      catch (_) { return { ok: false }; }
    },

    receipt: { feature: q.key, label: q.label, cost: q.cost, unit: q.unit, units: q.units, charged: q.total },
  };
}

/**
 * Convenience wrapper: reserve, run, settle (or release on throw).
 * `fn` receives the meter and may return { units } to bill metered usage.
 */
async function withCredits(req, featureKey, opts, fn) {
  const m = await meter(req, featureKey, opts);
  if (!m.ok) { const e = new Error(m.message || m.error || 'insufficient_credits'); e.status = m.status || 402; e.payload = m; throw e; }
  try {
    const out = await fn(m);
    await m.settle(out && out.__units);
    if (out && typeof out === 'object') { delete out.__units; out.credits = m.receipt; }
    return out;
  } catch (err) {
    await m.release(err && err.message ? String(err.message).slice(0, 200) : 'run failed');
    throw err;
  }
}

/* ── recharge ─────────────────────────────────────────────────────────────── */

/**
 * Start a top-up. This does NOT take a payment — no processor is wired up in
 * this repo. It records a pending order and returns it; whichever processor the
 * operator connects calls `fulfilOrder()` on its webhook. When
 * CREDITS_ALLOW_SELF_SERVE=1 (dev/staging), the order is fulfilled immediately
 * so the flow is testable end to end.
 */
async function createOrder(auth, { pack_key, workspace_id }) {
  const p = catalog.pack(pack_key);
  if (!p) { const e = new Error('Unknown credit pack.'); e.status = 400; throw e; }
  const credits = p.credits + (p.bonus || 0);
  const rows = await serviceRest('credit_orders?select=*', {
    method: 'POST',
    body: [{ user_id: auth.user_id, workspace_id: workspace_id || null, pack_key: p.key, credits, status: 'pending' }],
    prefer: 'return=representation',
  });
  const order = Array.isArray(rows) ? rows[0] : rows;

  if (String(process.env.CREDITS_ALLOW_SELF_SERVE || '') === '1') {
    return await fulfilOrder(order.id, { provider: 'self_serve', provider_ref: 'CREDITS_ALLOW_SELF_SERVE=1' });
  }
  return {
    ok: true, order, status: 'pending', credited: false,
    message: 'Order recorded. No payment processor is connected to this deployment, so an operator must confirm it before the credits land.',
  };
}

/** Mark an order paid and move the credits. Server-side only. */
async function fulfilOrder(orderId, { provider, provider_ref } = {}) {
  const rows = await serviceRest(`credit_orders?select=*&id=eq.${encodeURIComponent(orderId)}&limit=1`);
  const order = Array.isArray(rows) ? rows[0] : null;
  if (!order) { const e = new Error('Order not found.'); e.status = 404; throw e; }
  if (order.status === 'paid') return { ok: true, order, credited: false, message: 'Order was already fulfilled.' };

  await serviceRest(`credit_orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    body: { status: 'paid', provider: provider || order.provider, provider_ref: provider_ref || order.provider_ref, updated_at: new Date().toISOString() },
    prefer: 'return=minimal',
  });
  const r = await rpc('credit_grant', {
    p_user: order.user_id, p_workspace: order.workspace_id, p_amount: order.credits,
    p_kind: 'topup', p_ref: order.id, p_note: `Recharge: ${order.pack_key}`,
    p_meta: { pack: order.pack_key, provider: provider || null },
  });
  return { ok: true, order: Object.assign({}, order, { status: 'paid' }), credited: true, balance: r && r.balance, credits: order.credits };
}

/* ── router (mounted at /api/public-config?action=credits) ────────────────── */

async function handle(req, res) {
  const q = (req && req.query) || {};
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const op = String(q.op || body.op || 'balance').toLowerCase();

  // The price list is public: the UI must be able to show what a feature costs
  // before the user signs in or tops up.
  if (op === 'catalog' || op === 'prices') {
    return res.status(200).json({
      ok: true,
      features: await priceList().catch(() => catalog.list()),
      packs: catalog.PACKS,
      welcome_grant: catalog.welcomeGrant(),
      configured: configured(),
    });
  }

  const auth = await brandCore.requireUser(req);
  if (!auth.ok) return res.status(auth.status || 401).json(auth);

  if (!configured()) {
    return res.status(503).json({
      ok: false, error: 'credits_unavailable',
      message: 'The credit meter needs SUPABASE_SERVICE_ROLE_KEY on this deployment.',
      features: await priceList().catch(() => catalog.list()), packs: catalog.PACKS,
    });
  }

  const workspaceId = String(q.workspace_id || body.workspace_id || '') || null;

  try {
    switch (op) {
      case 'balance': {
        const w = await wallet(auth.user_id, workspaceId);
        return res.status(200).json({
          ok: true,
          wallet: { id: w.id, balance: w.balance, held: w.held, lifetime_granted: w.lifetime_granted, lifetime_spent: w.lifetime_spent, low_balance_threshold: w.low_balance_threshold, workspace_id: w.workspace_id },
          low: Number(w.balance) <= Number(w.low_balance_threshold || 0),
          features: await priceList(),
          packs: catalog.PACKS,
        });
      }
      case 'ledger':
        return res.status(200).json({ ok: true, entries: await ledger(auth.user_id, workspaceId, q.limit || body.limit) });
      case 'usage':
        return res.status(200).json({ ok: true, usage: await usage(auth.user_id, workspaceId, q.days || body.days || 30) });
      case 'quote': {
        const ov = await overrides();
        return res.status(200).json({ ok: true, quote: catalog.quote(String(q.feature || body.feature || ''), q.units || body.units, ov) });
      }
      case 'recharge':
        return res.status(200).json(await createOrder(auth, { pack_key: body.pack_key || q.pack_key, workspace_id: workspaceId }));
      case 'orders': {
        const rows = await serviceRest(`credit_orders?select=*&user_id=eq.${encodeURIComponent(auth.user_id)}&order=created_at.desc&limit=25`);
        return res.status(200).json({ ok: true, orders: Array.isArray(rows) ? rows : [] });
      }
      case 'fulfil':
      case 'fulfill': {
        // Operator-only: confirms a payment taken outside this app.
        const secret = String(process.env.CRON_SECRET || '');
        const sent = String((req.headers && (req.headers.authorization || '')) || '').replace(/^Bearer\s+/i, '');
        if (!secret || sent !== secret) return res.status(403).json({ ok: false, error: 'operator_only' });
        return res.status(200).json(await fulfilOrder(body.order_id || q.order_id, { provider: body.provider, provider_ref: body.provider_ref }));
      }
      default:
        return res.status(400).json({ ok: false, error: 'unknown_credits_operation', available: ['catalog', 'balance', 'ledger', 'usage', 'quote', 'recharge', 'orders'] });
    }
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message || 'credits_operation_failed' });
  }
}

module.exports = {
  handle, meter, withCredits, wallet, ledger, usage, priceList, overrides,
  createOrder, fulfilOrder, configured, catalog,
};
