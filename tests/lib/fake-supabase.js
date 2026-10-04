'use strict';
/**
 * tests/lib/fake-supabase.js — an in-memory Supabase for the executed
 * money-path specs (credits, dispatch, OAuth, deliverability).
 * ---------------------------------------------------------------------------
 * Every module under test does its I/O through ONE seam, global.fetch, so this
 * replaces that seam with something that behaves like the real thing on the
 * exact surface those modules use:
 *
 *   /auth/v1/user               GoTrue: the bearer token names a user, or 401.
 *   /rest/v1/rpc/<fn>           PostgREST RPC: the credit ledger functions,
 *                               re-implemented from the SQL in
 *                               20260809130000_credits.sql so a hold, a settle
 *                               and a release move a balance the way Postgres
 *                               would (never charge more than reserved, a
 *                               release after a settle is a no-op, ...).
 *   /rest/v1/<table>?<filters>  PostgREST: eq / neq / is / in / lt / lte / gt /
 *                               gte / or=(...) filters, select projection,
 *                               order, limit, Prefer: return=representation |
 *                               return=minimal | resolution=merge-duplicates |
 *                               count=exact (Content-Range), on_conflict, and
 *                               UNIQUE INDEXES that answer a duplicate insert
 *                               with 409 / 23505 - because the dispatch queue's
 *                               anti-double-post guarantee IS that index, and
 *                               a fake that silently accepted a second row
 *                               would pass a queue that double-posts.
 *   RLS                         a call made with a user's token sees only the
 *                               rows of workspaces that user owns or is a
 *                               member of; the service key sees everything.
 *                               That is the boundary the modules rely on, so
 *                               the fake enforces it rather than trusting the
 *                               caller to have filtered.
 *
 * Any other URL THROWS unless a spec routed it (`db.route(test, handler)`), so
 * a platform call that escaped a gate fails the test loudly instead of being
 * answered by a default.
 *
 * Nothing here is a mock of the module under test. The modules run unmodified.
 */

const crypto = require('crypto');

const SERVICE_KEY = 'service-role-key-for-tests';
const ANON_KEY = 'anon-key-for-tests';
const BASE = 'https://fixture.supabase.co';

/** The unique indexes the migrations declare, per table (what a duplicate insert trips over). */
const UNIQUE = {
  dispatch_jobs: [['workspace_id', 'idempotency_key']],                          // dispatch_jobs_idem_idx
  platform_webhook_events: [['provider', 'external_id']],                        // webhook_events_dedupe_idx
  workspace_connections: [['workspace_id', 'provider']],
  workspace_connection_secrets: [['connection_id']],
  workspace_ai_routing: [['workspace_id']],
  oauth_authorization_states: [['state']],
  credit_wallets: [['user_id', 'workspace_id']],
  domain_health_profiles: [['workspace_id', 'domain', 'role']],
  // 20261004150000_social_gateway.sql
  social_inbound_events: [['provider', 'event_id']],                             // social_inbound_events_dedupe_idx
  social_metric_snapshots: [['workspace_id', 'provider', 'kind', 'external_id', 'captured_on']],
  social_creative_flags: [['workspace_id', 'provider', 'external_id', 'metric', 'basis']],
  social_gateway_settings: [['workspace_id']],
};

/** Column defaults the migrations declare, applied on insert the way Postgres would. */
const DEFAULTS = {
  dispatch_jobs: { status: 'queued', attempt_count: 0, max_attempts: 5, lease_owner: null, lease_expires_at: null, external_id: null, external_status: null, result: null, last_error: null, completed_at: null, retry_after_at: null, dry_run: false },
  workspace_connections: { status: 'active', config: {}, secret_fields: [], secret_hint: '' },
  platform_webhook_events: { verified: false, processed_at: null },
  social_creative_flags: { status: 'open', decided_by: null, decided_at: null },
  social_inbound_events: { items: [] },
};

/** Tables whose rows are scoped to a workspace for RLS. */
const WORKSPACE_SCOPED = new Set([
  'dispatch_jobs', 'dispatch_attempts', 'preflight_audits', 'platform_sync_log', 'platform_webhook_events',
  'workspace_connections', 'workspace_ai_routing', 'domain_health_profiles', 'channel_mappings',
  'social_inbound_events', 'social_metric_snapshots', 'social_creative_flags', 'social_gateway_settings',
]);

function uuid() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }

function response(status, body, headers) {
  const text = body === undefined || body === null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  const h = Object.assign({ 'content-type': 'application/json' }, headers || {});
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (h[String(k).toLowerCase()] == null ? null : String(h[String(k).toLowerCase()])) },
    text: async () => text,
    json: async () => (text ? JSON.parse(text) : null),
  };
}

/** PostgREST's duplicate-key answer. The message is what the modules regex on. */
function duplicate(table, cols) {
  return response(409, {
    code: '23505',
    details: `Key (${cols.join(', ')}) already exists.`,
    hint: null,
    message: `duplicate key value violates unique constraint "${table}_${cols.join('_')}_idx"`,
  });
}

function cmp(a, b) {
  const numeric = (v) => v !== null && v !== undefined && String(v).trim() !== '' && Number.isFinite(Number(v));
  if (numeric(a) && numeric(b)) return Number(a) - Number(b);
  const sa = String(a == null ? '' : a); const sb = String(b == null ? '' : b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;   // ISO timestamps compare correctly as strings
}

/**
 * A column, or a JSON path into one (`config->>page_id`, `config->a->>b`), the
 * way PostgREST reads a filter key. `->>` yields text, which is what an
 * eq filter compares against.
 */
function fieldOf(row, col) {
  if (!/->/.test(col)) return row[col];
  const parts = col.split(/->>?/);
  let v = row[parts[0]];
  for (const k of parts.slice(1)) v = v == null ? undefined : v[k];
  return v == null ? v : (/->>[^>]*$/.test(col) && typeof v !== 'string' ? String(v) : v);
}

/** One PostgREST filter expression (`col.op.value` form, as used inside or=()). */
function matchOne(row, col, op, val) {
  const v = fieldOf(row, col);
  switch (op) {
    case 'eq': return String(v) === String(val) && v != null;
    case 'neq': return String(v) !== String(val);
    case 'is': return val === 'null' ? v == null : val === 'true' ? v === true : val === 'false' ? v === false : false;
    case 'in': {
      const list = String(val).replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      return v != null && list.indexOf(String(v)) >= 0;
    }
    case 'lt': return v != null && cmp(v, val) < 0;
    case 'lte': return v != null && cmp(v, val) <= 0;
    case 'gt': return v != null && cmp(v, val) > 0;
    case 'gte': return v != null && cmp(v, val) >= 0;
    default: throw new Error(`fake-supabase: unsupported filter operator "${op}" on ${col}`);
  }
}

function parseQuery(qs) {
  const params = new URLSearchParams(qs || '');
  const filters = [];
  let select = null; let order = []; let limit = null; let onConflict = null; let offset = 0;
  for (const [k, raw] of params.entries()) {
    // PostgREST's own paging parameter. Without it a paged reader would be
    // handed page one again and again and still look like it had read it all.
    if (k === 'offset') { offset = Number(raw) || 0; continue; }
    if (k === 'select') { select = raw === '*' ? null : raw.split(',').map((s) => s.trim()).filter(Boolean); continue; }
    if (k === 'order') { order = raw.split(',').map((s) => { const [col, dir] = s.split('.'); return { col, desc: dir === 'desc' }; }); continue; }
    if (k === 'limit') { limit = Number(raw); continue; }
    if (k === 'on_conflict') { onConflict = raw.split(',').map((s) => s.trim()); continue; }
    if (k === 'or') {
      const inner = raw.replace(/^\(|\)$/g, '');
      const parts = [];
      // split on commas that are not inside a nested in.(...) list
      let depth = 0; let cur = '';
      for (const ch of inner) {
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
      }
      if (cur) parts.push(cur);
      filters.push({ or: parts.map((p) => { const m = /^([^.]+)\.([a-z]+)\.(.*)$/s.exec(p); return { col: m[1], op: m[2], val: m[3] }; }) });
      continue;
    }
    const m = /^([a-z]+)\.(.*)$/s.exec(raw);
    if (!m) continue;
    filters.push({ col: k, op: m[1], val: m[2] });
  }
  return { filters, select, order, limit, onConflict, offset };
}

function matches(row, filters) {
  return filters.every((f) => (f.or ? f.or.some((x) => matchOne(row, x.col, x.op, x.val)) : matchOne(row, f.col, f.op, f.val)));
}

function project(row, select) {
  if (!select) return Object.assign({}, row);
  const out = {};
  for (const c of select) if (row[c] !== undefined) out[c] = row[c];
  return out;
}

class FakeSupabase {
  constructor() {
    this.url = BASE;
    this.serviceKey = SERVICE_KEY;
    this.anonKey = ANON_KEY;
    this.users = {};          // token -> { id, email }
    this.active = {};         // user id -> active workspace id
    this.workspaces = {};     // id -> row (owner_id, ...)
    this.members = [];        // { workspace_id, user_id, role }
    this.tables = {};         // name -> rows
    this.calls = [];          // every fetch, in order
    this.routes = [];         // [{ test, handler }]
    this.failures = {};       // table -> http status to answer with (a store outage)
    this.rpcFailures = {};    // rpc fn -> http status
    this.rpc = {};            // fn -> (args) => value | Response
    this.clock = Date.now();  // strictly increasing, so `order=created_at.desc` never ties
  }

  /** A timestamp later than every one handed out before it. */
  tick() { this.clock = Math.max(this.clock + 1, Date.now()); return new Date(this.clock).toISOString(); }

  /* ── world building ─────────────────────────────────────────────────────── */

  addUser(token, id, email) { this.users[token] = { id, email }; return this; }
  addWorkspace(id, ownerId, extra) {
    this.workspaces[id] = Object.assign({ id, slug: id, name: id, owner_id: ownerId, status: 'active' }, extra || {});
    return this;
  }
  addMember(workspaceId, userId, role) { this.members.push({ workspace_id: workspaceId, user_id: userId, role }); return this; }
  setActive(userId, workspaceId) { this.active[userId] = workspaceId; return this; }

  table(name) { if (!this.tables[name]) this.tables[name] = []; return this.tables[name]; }
  insert(name, row) { const r = Object.assign({ id: uuid(), created_at: this.tick() }, row); this.table(name).push(r); return r; }
  find(name, pred) { return this.table(name).find(pred) || null; }
  where(name, pred) { return this.table(name).filter(pred); }

  /** Route a non-Supabase URL. `test(url, init)` -> bool; `handler(url, init, call)` -> Response | body. */
  route(test, handler) { this.routes.push({ test, handler }); return this; }
  /** Calls that left for a host other than the fixture Supabase. */
  external() { return this.calls.filter((c) => !c.url.startsWith(BASE)); }
  clearCalls() { this.calls.length = 0; }

  /* ── identity + RLS ─────────────────────────────────────────────────────── */

  userFor(token) { return this.users[token] || null; }
  mayRead(user, wsId) {
    if (!user || !wsId) return false;
    const ws = this.workspaces[wsId];
    if (!ws) return false;
    if (ws.owner_id === user.id) return true;
    return this.members.some((m) => m.workspace_id === wsId && m.user_id === user.id);
  }
  visible(table, row, user) {
    if (user === 'service') return true;
    if (!user) return false;
    if (table === 'brand_workspaces') return this.mayRead(user, row.id);
    if (table === 'brand_user_prefs') return row.user_id === user.id;
    if (table === 'brand_workspace_members') return row.user_id === user.id || this.mayRead(user, row.workspace_id);
    if (WORKSPACE_SCOPED.has(table)) return this.mayRead(user, row.workspace_id);
    return true;
  }

  /* ── the fetch ──────────────────────────────────────────────────────────── */

  install() {
    this.realFetch = global.fetch;
    global.fetch = (url, init) => this.fetch(String(url), init || {});
    return this;
  }
  restore() { if (this.realFetch) global.fetch = this.realFetch; }

  async fetch(url, init) {
    const headers = Object.assign({}, init.headers || {});
    const lower = {};
    for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k];
    const method = String(init.method || 'GET').toUpperCase();
    const token = String(lower.authorization || '').replace(/^Bearer\s+/i, '');
    let body = null;
    if (init.body !== undefined && init.body !== null) {
      try { body = JSON.parse(init.body); } catch (_) { body = String(init.body); }
    }
    const call = { url, method, token, headers: lower, body };
    this.calls.push(call);

    if (!url.startsWith(BASE)) {
      for (const r of this.routes) {
        if (r.test(url, init)) {
          const out = await r.handler(url, init, call);
          if (out && typeof out.text === 'function' && typeof out.status === 'number') return out;
          return response(200, out);
        }
      }
      throw new Error(`fake-supabase: unrouted network call escaped the module under test: ${method} ${url}`);
    }

    const u = new URL(url);
    if (u.pathname === '/auth/v1/user') {
      const user = this.userFor(token);
      return user ? response(200, user) : response(401, { message: 'invalid JWT' });
    }

    const who = token === SERVICE_KEY ? 'service' : this.userFor(token);
    if (!who) return response(401, { message: 'JWT invalid', code: 'PGRST301' });

    const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/i.exec(u.pathname);
    if (rpc) return this.callRpc(rpc[1], body || {}, who);

    const tbl = /^\/rest\/v1\/([a-z0-9_]+)$/i.exec(u.pathname);
    if (!tbl) return response(404, { message: `no route for ${u.pathname}` });
    return this.rest(tbl[1], u.search.slice(1), method, body, lower, who);
  }

  async callRpc(fn, args, who) {
    if (this.rpcFailures[fn]) return response(this.rpcFailures[fn], { message: `fixture: ${fn} is down` });
    const h = this.rpc[fn];
    if (!h) return response(404, { message: `Could not find the function public.${fn}` });
    const out = await h(args, who);
    if (out && typeof out.text === 'function' && typeof out.status === 'number') return out;
    return response(200, out === undefined ? null : out);
  }

  rest(table, qs, method, body, headers, who) {
    if (this.failures[table]) return response(this.failures[table], { message: `fixture: ${table} is down` });
    const q = parseQuery(qs);
    const prefer = String(headers.prefer || '');
    const rows = this.table(table);
    const seen = (r) => this.visible(table, r, who);

    if (method === 'GET') {
      let out = rows.filter((r) => seen(r) && matches(r, q.filters));
      for (const o of q.order.slice().reverse()) out = out.slice().sort((a, b) => (o.desc ? -1 : 1) * cmp(a[o.col], b[o.col]));
      const total = out.length;
      if (q.offset) out = out.slice(q.offset);
      if (q.limit != null) out = out.slice(0, q.limit);
      if (/count=exact/.test(prefer)) {
        const range = headers.range ? String(headers.range) : `0-${Math.max(0, out.length - 1)}`;
        return response(206, out.map((r) => project(r, q.select)), { 'content-range': `${range}/${total}` });
      }
      return response(200, out.map((r) => project(r, q.select)));
    }

    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const saved = [];
      for (const incoming of list) {
        const row = Object.assign({ id: uuid(), created_at: this.tick() }, DEFAULTS[table] || {}, incoming);
        const keys = q.onConflict ? [q.onConflict] : (UNIQUE[table] || []);
        let merged = false;
        for (const cols of keys) {
          if (!cols.every((c) => row[c] != null)) continue;
          const hit = rows.find((r) => cols.every((c) => String(r[c]) === String(row[c])));
          if (!hit) continue;
          if (/resolution=merge-duplicates/.test(prefer)) { Object.assign(hit, incoming); saved.push(hit); merged = true; break; }
          return duplicate(table, cols);
        }
        if (merged) continue;
        rows.push(row);
        saved.push(row);
      }
      if (/return=representation/.test(prefer)) return response(201, saved.map((r) => project(r, q.select)));
      return response(201, null);
    }

    if (method === 'PATCH') {
      const hit = rows.filter((r) => seen(r) && matches(r, q.filters));
      for (const r of hit) Object.assign(r, body || {});
      if (/return=representation/.test(prefer)) return response(200, hit.map((r) => project(r, q.select)));
      return response(204, null);
    }

    if (method === 'DELETE') {
      const gone = rows.filter((r) => seen(r) && matches(r, q.filters));
      this.tables[table] = rows.filter((r) => gone.indexOf(r) < 0);
      // The secrets row goes with its connection through the foreign key.
      if (table === 'workspace_connections') {
        const ids = new Set(gone.map((r) => r.id));
        this.tables.workspace_connection_secrets = this.table('workspace_connection_secrets').filter((s) => !ids.has(s.connection_id));
      }
      return response(204, null);
    }
    return response(405, { message: 'method not allowed' });
  }

  /* ── PostgREST tables the brand core reads ──────────────────────────────── */

  /** Materialise the identity tables from the world so the generic REST path serves them. */
  syncIdentityTables() {
    this.tables.brand_workspaces = Object.values(this.workspaces).map((w) => Object.assign({}, w));
    this.tables.brand_workspace_members = this.members.map((m) => Object.assign({ id: uuid() }, m));
    this.tables.brand_user_prefs = Object.keys(this.active).map((uid) => ({ id: uuid(), user_id: uid, active_workspace_id: this.active[uid] }));
    return this;
  }
}

/* ── the credit ledger, as the SQL functions define it ──────────────────────── */

/**
 * Re-implements credit_wallet_id / credit_grant / credit_hold / credit_settle /
 * credit_release / credit_usage / credit_fulfil_order from
 * supabase/migrations/20260809130000_credits.sql and 20260809170000. The
 * numbers move exactly as the SQL moves them; the JSON shapes are the SQL's
 * jsonb_build_object shapes. Errors the SQL raises come back as 400 with the
 * same message, which is how PostgREST reports a raised exception.
 */
function installCreditsRpc(db) {
  const wallets = () => db.table('credit_wallets');
  const ledger = () => db.table('credit_ledger');
  const orders = () => db.table('credit_orders');
  const raise = (msg) => response(400, { code: 'P0001', message: msg });

  const walletId = (user, ws) => {
    let w = wallets().find((x) => x.user_id === user && (x.workspace_id || null) === (ws || null));
    if (!w) {
      w = { id: uuid(), user_id: user, workspace_id: ws || null, balance: 0, held: 0, lifetime_granted: 0, lifetime_spent: 0, low_balance_threshold: 50, created_at: db.tick() };
      wallets().push(w);
    }
    return w;
  };
  const entry = (w, fields) => { const r = Object.assign({ id: uuid(), wallet_id: w.id, user_id: w.user_id, workspace_id: w.workspace_id, created_at: db.tick() }, fields); ledger().push(r); return r; };

  db.rpc.credit_wallet_id = (a) => walletId(a.p_user, a.p_workspace).id;

  db.rpc.credit_grant = (a) => {
    const amount = Number(a.p_amount);
    if (!Number.isFinite(amount) || amount <= 0) return raise('amount must be > 0');
    if (a.p_ref === 'welcome' && ledger().some((l) => l.user_id === a.p_user && l.ref === 'welcome' && l.kind === 'grant')) {
      return response(409, { code: '23505', message: 'duplicate key value violates unique constraint "credit_ledger_welcome_once_user_idx"' });
    }
    const w = walletId(a.p_user, a.p_workspace);
    w.balance += amount; w.lifetime_granted += amount;
    entry(w, { kind: a.p_kind || 'grant', delta: amount, balance_after: w.balance, ref: a.p_ref || null, note: a.p_note || null, meta: a.p_meta || {} });
    return { ok: true, wallet_id: w.id, balance: w.balance, granted: amount };
  };

  db.rpc.credit_hold = (a) => {
    const amount = Number(a.p_amount);
    if (!Number.isFinite(amount) || amount < 0) return raise('amount must be >= 0');
    const w = walletId(a.p_user, a.p_workspace);
    if (w.balance < amount) {
      return { ok: false, error: 'insufficient_credits', balance: w.balance, required: amount, short_by: amount - w.balance, feature_key: a.p_feature, wallet_id: w.id };
    }
    w.balance -= amount; w.held += amount;
    const hold = uuid();
    entry(w, { kind: 'hold', feature_key: a.p_feature, feature_label: a.p_label || null, units: a.p_units, unit_label: a.p_unit_label || null, delta: -amount, balance_after: w.balance, hold_id: hold, ref: a.p_ref || null, meta: a.p_meta || {} });
    return { ok: true, hold_id: hold, wallet_id: w.id, balance: w.balance, held: amount };
  };

  const findHold = (id) => ledger().find((l) => l.hold_id === id && l.kind === 'hold') || null;
  const closed = (id) => ledger().some((l) => l.hold_id === id && (l.kind === 'spend' || l.kind === 'release'));

  db.rpc.credit_settle = (a) => {
    const h = findHold(a.p_hold);
    if (!h) return raise(`unknown hold ${a.p_hold}`);
    if (closed(a.p_hold)) return raise(`hold ${a.p_hold} already settled`);
    const w = wallets().find((x) => x.id === h.wallet_id);
    const held = -h.delta;
    const actual = Math.max(0, Math.min(a.p_actual == null ? held : Number(a.p_actual), held));
    const refund = held - actual;
    w.held -= held; w.balance += refund; w.lifetime_spent += actual;
    entry(w, { kind: 'spend', feature_key: h.feature_key, feature_label: h.feature_label, units: a.p_units == null ? h.units : a.p_units, unit_label: h.unit_label, delta: 0, balance_after: w.balance, hold_id: a.p_hold, ref: a.p_ref || h.ref, meta: a.p_meta || {} });
    if (refund > 0) entry(w, { kind: 'refund', feature_key: h.feature_key, feature_label: h.feature_label, delta: refund, balance_after: w.balance, hold_id: a.p_hold, ref: a.p_ref || h.ref, note: 'unused portion of the reservation' });
    return { ok: true, charged: actual, refunded: refund, balance: w.balance, wallet_id: w.id };
  };

  db.rpc.credit_release = (a) => {
    const h = findHold(a.p_hold);
    if (!h) return raise(`unknown hold ${a.p_hold}`);
    if (closed(a.p_hold)) return { ok: true, already_settled: true };
    const w = wallets().find((x) => x.id === h.wallet_id);
    const held = -h.delta;
    w.held -= held; w.balance += held;
    entry(w, { kind: 'release', feature_key: h.feature_key, feature_label: h.feature_label, delta: held, balance_after: w.balance, hold_id: a.p_hold, ref: h.ref, note: a.p_note || 'run failed — reservation returned' });
    return { ok: true, released: held, balance: w.balance };
  };

  db.rpc.credit_usage = (a) => {
    const by = {};
    for (const l of ledger()) {
      if (l.user_id !== a.p_user || !l.feature_key) continue;
      if (a.p_workspace && l.workspace_id !== a.p_workspace) continue;
      const b = by[l.feature_key] || (by[l.feature_key] = { feature_key: l.feature_key, feature_label: l.feature_label, runs: 0, credits: 0, last_used: l.created_at });
      if (l.kind === 'spend') b.runs += 1;
      if (l.kind === 'hold') b.credits += -l.delta;
      if (l.kind === 'refund' || l.kind === 'release') b.credits -= l.delta;
    }
    return Object.values(by).sort((x, y) => y.credits - x.credits);
  };

  db.rpc.credit_fulfil_order = (a) => {
    const o = orders().find((x) => x.id === a.p_order);
    if (!o) return { ok: false };
    if (o.status !== 'pending') return { ok: true, credited: false, status: o.status, already_fulfilled: o.status === 'paid' };
    o.status = 'paid'; o.provider = a.p_provider || null; o.provider_ref = a.p_ref || null; o.paid_at = db.tick();
    const g = db.rpc.credit_grant({ p_user: o.user_id, p_workspace: o.workspace_id, p_amount: o.credits, p_kind: 'purchase', p_ref: `order:${o.id}`, p_note: `${o.pack_key} pack` });
    return { ok: true, credited: true, credits: o.credits, balance: g.balance, pack_key: o.pack_key };
  };
}

/* ── request / response shapes as a Vercel handler sees them ───────────────── */

function makeReq({ token, query, body, method, headers } = {}) {
  return {
    method: method || (body ? 'POST' : 'GET'),
    headers: Object.assign({}, token ? { authorization: `Bearer ${token}` } : {}, headers || {}),
    query: query || {},
    body: body || {},
    url: '/api/test' + (query ? '?' + new URLSearchParams(query).toString() : ''),
  };
}

/** A recording response. `writes` keeps the order of status/json/end calls. */
function makeRes() {
  const out = { code: 200, payload: null, ended: null, headers: {}, writes: [], head: null };
  out.status = (c) => { out.code = c; out.writes.push(['status', c]); return out; };
  out.json = (p) => { out.payload = p; out.writes.push(['json']); return out; };
  out.end = (...args) => { out.ended = args; out.writes.push(['end']); return out; };
  out.setHeader = (k, v) => { out.headers[String(k).toLowerCase()] = v; };
  out.writeHead = (c, h) => { out.code = c; out.head = h || null; out.writes.push(['writeHead', c]); return out; };
  return out;
}

/** Save and restore process.env keys around a spec. */
function envScope(keys) {
  const saved = {};
  return {
    save() { for (const k of keys) saved[k] = process.env[k]; },
    restore() { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } },
  };
}

module.exports = { FakeSupabase, installCreditsRpc, makeReq, makeRes, envScope, response, SERVICE_KEY, ANON_KEY, BASE, uuid, nowIso };
