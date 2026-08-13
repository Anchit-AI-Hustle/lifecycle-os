// Payment gateway connections (api/_shared/payments-core.js + payments.html).
//
// Three properties are worth a test here, because all three fail silently:
//
//   1. With NO credentials configured, every operation returns the
//      { connected:false, would_request } envelope instead of throwing. That is
//      what makes the feature demonstrable before anyone has registered a
//      Connect platform, and a regression looks like a 500 nobody notices until
//      a demo.
//   2. A secret never comes back out. Not in a response body, not in a
//      would_request, not in an error. The failure mode is invisible from the
//      UI and catastrophic.
//   3. One workspace cannot read another's connection. The database policy is
//      expressed in SQL and cannot run here, so the fake PostgREST below
//      ENFORCES the same rules the migration does: a row is only visible to a
//      token whose user owns it, and the four *_enc columns are refused to a
//      user token exactly as the column grants refuse them. A test that let the
//      fake be permissive would pass while the real thing leaked.
//
// Run: npx playwright test tests/payments-gateway.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const core = require('../api/_shared/payments-core.js');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

// ── The fixture world ───────────────────────────────────────────────────────
// Two brands, two owners, and one connection that only the first brand may see.
const USERS = {
  'tok-a': { id: 'user-a', email: 'a@example.com' },
  'tok-b': { id: 'user-b', email: 'b@example.com' },
};
const WORKSPACES = [
  { id: 'ws-a', name: 'Brand A', owner: 'user-a' },
  { id: 'ws-b', name: 'Brand B', owner: 'user-b' },
];
const PREFS = { 'user-a': 'ws-a', 'user-b': 'ws-b' };

// The plaintext that must never appear in any response, anywhere.
const PLAINTEXT_TOKEN = 'sk_live_THIS_MUST_NEVER_BE_ECHOED_9911';

let CONNECTIONS = [];
let STATES = [];

function resetFixtures() {
  CONNECTIONS = [{
    id: 'conn-1',
    workspace_id: 'ws-a',
    gateway: 'stripe',
    connect_kind: 'oauth',
    status: 'connected',
    account_id: 'acct_A',
    account_label: 'Brand A Stripe',
    livemode: true,
    scope: 'read_only',
    // Stored the way the real column would hold it: sealed, never plaintext.
    access_token_enc: null,
    refresh_token_enc: null,
    secret_enc: null,
    webhook_secret_enc: null,
    token_expires_at: null,
    masked_hint: '****9911',
    connected_by: 'user-a',
    connected_at: '2026-08-01T00:00:00Z',
    last_checked_at: null,
    last_error: null,
    meta: {},
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }];
  STATES = [];
}

// Columns the migration revokes from the authenticated role. The fake refuses
// them for a user token so that widening SAFE_COLUMNS breaks a test rather than
// shipping.
const SERVICE_ONLY = ['access_token_enc', 'refresh_token_enc', 'secret_enc', 'webhook_secret_enc'];

let supa;            // fake Supabase
let app;             // static + api server
let base;            // app origin
let SERVICE_KEY;

function userFor(req) {
  const h = String(req.headers.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const tok = m ? m[1] : '';
  if (tok === SERVICE_KEY) return { service: true };
  return USERS[tok] ? { user: USERS[tok] } : null;
}

function ownedBy(userId) {
  return WORKSPACES.filter((w) => w.owner === userId).map((w) => w.id);
}

function eqValue(params, key) {
  const raw = params.get(key);
  if (!raw) return null;
  return raw.startsWith('eq.') ? decodeURIComponent(raw.slice(3)) : decodeURIComponent(raw);
}

function startSupabase() {
  return new Promise((resolve) => {
    supa = http.createServer((req, res) => {
      const [url, qs] = (req.url || '/').split('?');
      const params = new URLSearchParams(qs || '');
      const who = userFor(req);
      const send = (code, payload) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (url === '/auth/v1/user') {
        if (!who || who.service) return send(401, { message: 'invalid' });
        return send(200, { id: who.user.id, email: who.user.email });
      }

      if (!who) return send(401, { message: 'no token' });
      const visible = who.service ? null : ownedBy(who.user.id);

      let bodyText = '';
      req.on('data', (c) => { bodyText += c; });
      req.on('end', () => {
        let body = null;
        try { body = bodyText ? JSON.parse(bodyText) : null; } catch (_) { body = null; }

        if (url === '/rest/v1/brand_workspaces') {
          const id = eqValue(params, 'id');
          const rows = WORKSPACES
            .filter((w) => (!id || w.id === id) && (visible === null || visible.includes(w.id)))
            .map((w) => ({ id: w.id, name: w.name }));
          return send(200, rows);
        }

        if (url === '/rest/v1/brand_user_prefs') {
          const uid = eqValue(params, 'user_id');
          if (!who.service && uid !== who.user.id) return send(200, []);
          return send(200, PREFS[uid] ? [{ active_workspace_id: PREFS[uid] }] : []);
        }

        if (url === '/rest/v1/payment_gateway_connections') {
          const select = params.get('select') || '*';
          // The column grant, enforced on reads. A user token that names a
          // credential column, or asks for everything, is refused by Postgres
          // itself. DELETE is granted at table level, so it is not column
          // checked, which matches the migration.
          if (!who.service && req.method === 'GET') {
            const named = select === '*' ? SERVICE_ONLY : select.split(',');
            const bad = named.filter((c) => SERVICE_ONLY.includes(c.trim()));
            if (bad.length) return send(403, { message: 'permission denied for column ' + bad[0] });
          }
          const ws = eqValue(params, 'workspace_id');
          const id = eqValue(params, 'id');
          const match = (r) => (!ws || r.workspace_id === ws)
            && (!id || r.id === id)
            && (visible === null || visible.includes(r.workspace_id));

          if (req.method === 'DELETE') {
            CONNECTIONS = CONNECTIONS.filter((r) => !match(r));
            return send(204, null);
          }
          if (req.method === 'POST') {
            for (const row of (Array.isArray(body) ? body : [body])) {
              const i = CONNECTIONS.findIndex((r) => r.workspace_id === row.workspace_id && r.gateway === row.gateway);
              if (i >= 0) CONNECTIONS[i] = Object.assign({}, CONNECTIONS[i], row);
              else CONNECTIONS.push(Object.assign({ id: 'conn-' + (CONNECTIONS.length + 1) }, row));
            }
            return send(201, []);
          }
          const cols = select === '*' ? null : select.split(',').map((c) => c.trim());
          const rows = CONNECTIONS.filter(match).map((r) => {
            if (!cols) return r;
            const o = {};
            for (const c of cols) o[c] = r[c];
            return o;
          });
          return send(200, rows);
        }

        if (url === '/rest/v1/payment_oauth_states') {
          if (req.method === 'POST') {
            const row = Array.isArray(body) ? body[0] : body;
            if (!who.service && !visible.includes(row.workspace_id)) return send(403, { message: 'rls' });
            STATES.push(Object.assign({ expires_at: new Date(Date.now() + 900000).toISOString(), consumed_at: null }, row));
            return send(201, []);
          }
          const state = eqValue(params, 'state');
          let owned = STATES.filter((s) => s.state === state && (who.service || s.user_id === who.user.id));
          // PostgREST applies the WHOLE query string to a PATCH, not only to a
          // select. The claim on an oauth state relies on that: it filters
          // consumed_at=is.null so that exactly one of two racing callbacks
          // matches a row. A fake that ignores the filter would let both
          // through and report a replay guard that does not exist.
          if (params.get('consumed_at') === 'is.null') owned = owned.filter((s) => s.consumed_at == null);
          if (req.method === 'PATCH') {
            for (const s of owned) Object.assign(s, body);
            const wants = String(req.headers.prefer || '');
            // return=representation answers with the rows actually updated, so
            // an empty array is how the loser of the race finds out.
            if (wants.includes('return=representation')) return send(200, owned);
            return send(204, null);
          }
          return send(200, owned);
        }

        return send(404, { message: 'unhandled ' + url });
      });
    });
    supa.listen(0, '127.0.0.1', () => resolve());
  });
}

/** Call the router the way api/public-config.js does. */
function invoke(op, { token, body = {}, query = {} } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: 'payments.test' };
    if (token) headers.authorization = 'Bearer ' + token;
    const req = { method: 'POST', headers, query: Object.assign({ action: 'payments', op }, query), body };
    const res = {
      statusCode: 200,
      setHeader() {},
      removeHeader() {},
      status(c) { this.statusCode = c; return this; },
      json(j) { resolve({ status: this.statusCode, body: j }); },
      end() { resolve({ status: this.statusCode, body: null }); },
    };
    Promise.resolve(core.handle(req, res)).catch(reject);
  });
}

const ENV_KEYS = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PAYMENTS_ENCRYPTION_KEY',
  'PAYMENTS_PUBLIC_BASE_URL', 'STRIPE_CONNECT_CLIENT_ID', 'STRIPE_SECRET_KEY',
  'RAZORPAY_OAUTH_CLIENT_ID', 'RAZORPAY_OAUTH_CLIENT_SECRET', 'PAYPAL_PARTNER_CLIENT_ID',
  'PAYPAL_PARTNER_CLIENT_SECRET', 'PAYPAL_PARTNER_MERCHANT_ID', 'SHOPIFY_APP_CLIENT_ID',
  'SHOPIFY_APP_CLIENT_SECRET', 'SHOPIFY_ALLOW_WRITES',
];
const SAVED = {};

test.beforeAll(async () => {
  for (const k of ENV_KEYS) SAVED[k] = process.env[k];
  await startSupabase();

  SERVICE_KEY = 'service-role-key';
  resetFixtures();

  // Deliberately NO gateway credentials. Every gateway op in this file runs in
  // the not-configured state, which is the state the contract is about.
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.SUPABASE_URL = 'http://127.0.0.1:' + supa.address().port;
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.PAYMENTS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  process.env.PAYMENTS_PUBLIC_BASE_URL = 'https://payments.test';

  app = http.createServer((req, res) => {
    const [url, qs] = (req.url || '/').split('?');
    if (url === '/api/public-config') {
      const params = new URLSearchParams(qs || '');
      if (params.get('action') === 'payments') {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          let body = {};
          try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
          const q = {}; params.forEach((v, k) => { q[k] = v; });
          const shim = {
            method: req.method, headers: req.headers, query: q, body,
          };
          const out = {
            statusCode: 200,
            setHeader() {}, removeHeader() {},
            status(c) { this.statusCode = c; return this; },
            json(j) { res.writeHead(this.statusCode, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); },
            end() { res.writeHead(this.statusCode); res.end(); },
          };
          core.handle(shim, out);
        });
        return;
      }
      // Bootstrap config for auth.js. No real project, so the shell degrades.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ supabase: { url: '', anonKey: '' }, app: { name: 'Lifecycle OS' } }));
    }
    if (url.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{"ok":false}');
    }
    const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.address().port;
});

test.afterAll(async () => {
  if (app) await new Promise((r) => app.close(r));
  if (supa) await new Promise((r) => supa.close(r));
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k];
  }
});

test.beforeEach(() => resetFixtures());

/* ── 1. the degradation contract ─────────────────────────────────────────── */

test('with no credentials every connect returns a would_request instead of throwing', async () => {
  const cases = [
    { gateway: 'stripe', host: 'connect.stripe.com/oauth/authorize', method: 'GET' },
    { gateway: 'razorpay', host: 'auth.razorpay.com/authorize', method: 'GET' },
    { gateway: 'paypal', host: '/v2/customer/partner-referrals', method: 'POST' },
    { gateway: 'shopify_payments', host: '/admin/oauth/authorize', method: 'GET', extra: { shop: 'demo-store.myshopify.com' } },
  ];

  for (const c of cases) {
    const r = await invoke('connect', { token: 'tok-a', body: Object.assign({ gateway: c.gateway }, c.extra || {}) });
    expect(r.status, `${c.gateway} must answer, not error`).toBe(200);
    expect(r.body, `${c.gateway} must describe the call it would make`).toHaveProperty('would_request');
    expect(r.body.would_request.method).toBe(c.method);
    expect(r.body.would_request.url).toContain(c.host);
    // Never a bare success that implies a live connection.
    expect(r.body.connected === true).toBe(false);
  }
});

test('with no credentials every probe returns a would_request instead of throwing', async () => {
  for (const gw of ['stripe', 'razorpay', 'paypal', 'shopify_payments']) {
    const r = await invoke('probe', { token: 'tok-a', body: { gateway: gw } });
    expect(r.status, `${gw} probe must answer`).toBe(200);
    expect(r.body, `${gw} probe must degrade to a stub`).toHaveProperty('would_request');
    expect(r.body.would_request.url).toBeTruthy();
    expect(r.body.ok).toBeFalsy();
  }
});

test('disconnect degrades to a stub and still removes the local connection', async () => {
  expect(CONNECTIONS.filter((c) => c.workspace_id === 'ws-a')).toHaveLength(1);
  const r = await invoke('disconnect', { token: 'tok-a', body: { gateway: 'stripe' } });
  expect(r.status).toBe(200);
  expect(r.body.ok).toBe(true);
  expect(r.body.provider_revoke).toHaveProperty('would_request');
  expect(CONNECTIONS.filter((c) => c.workspace_id === 'ws-a')).toHaveLength(0);
});

test('the catalog answers without a session, since it describes providers not tenants', async () => {
  const r = await invoke('catalog', {});
  expect(r.status).toBe(200);
  expect(r.body.ok).toBe(true);
  expect(r.body.gateways.map((g) => g.id).sort())
    .toEqual(['paypal', 'razorpay', 'shopify_payments', 'stripe']);
  // Every gateway states its mechanism, its scopes and who holds what. A blank
  // one would render an empty card that looks like a bug in the page.
  for (const g of r.body.gateways) {
    expect(g.connect_kind, g.id).toBeTruthy();
    expect(g.scopes.length, g.id).toBeGreaterThan(0);
    expect(g.holds.platform, g.id).toBeTruthy();
    expect(g.holds.merchant, g.id).toBeTruthy();
    expect(g.pci.platform_scope, g.id).toBeTruthy();
    expect(g.webhooks.events.length, g.id).toBeGreaterThan(0);
  }
});

/* ── 2. secrets never come back out ──────────────────────────────────────── */

test('no response ever carries a credential, in any field', async () => {
  process.env.STRIPE_SECRET_KEY = PLAINTEXT_TOKEN;
  process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_test_client';
  process.env.RAZORPAY_OAUTH_CLIENT_SECRET = PLAINTEXT_TOKEN;
  process.env.PAYPAL_PARTNER_CLIENT_SECRET = PLAINTEXT_TOKEN;
  process.env.SHOPIFY_APP_CLIENT_SECRET = PLAINTEXT_TOKEN;
  try {
    const calls = [
      invoke('catalog', {}),
      invoke('webhooks', {}),
      invoke('status', { token: 'tok-a' }),
      invoke('probe', { token: 'tok-a', body: { gateway: 'stripe' } }),
      invoke('probe', { token: 'tok-a', body: { gateway: 'razorpay' } }),
      invoke('connect', { token: 'tok-a', body: { gateway: 'razorpay' } }),
      invoke('connect', { token: 'tok-a', body: { gateway: 'paypal' } }),
      invoke('disconnect', { token: 'tok-a', body: { gateway: 'stripe' } }),
    ];
    for (const p of calls) {
      const r = await p;
      const text = JSON.stringify(r.body || {});
      expect(text.includes(PLAINTEXT_TOKEN), 'a credential leaked into a response').toBe(false);
    }
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_CONNECT_CLIENT_ID;
    delete process.env.RAZORPAY_OAUTH_CLIENT_SECRET;
    delete process.env.PAYPAL_PARTNER_CLIENT_SECRET;
    delete process.env.SHOPIFY_APP_CLIENT_SECRET;
  }
});

test('the connection shape sent to a browser is a masked hint and nothing more', async () => {
  const r = await invoke('status', { token: 'tok-a' });
  expect(r.status).toBe(200);
  const conn = r.body.connections.stripe;
  expect(conn.connected).toBe(true);
  expect(conn.masked_hint).toBe('****9911');
  // The allowlist in publicConnection() is what guarantees this; a new column
  // must be added there deliberately rather than arriving by default.
  for (const key of Object.keys(conn)) {
    expect(SERVICE_ONLY.includes(key), `${key} must never reach the browser`).toBe(false);
  }
});

test('reading connections names only granted columns, so the column grant holds', async () => {
  // SAFE_COLUMNS is what the read asks for. If it ever grew to include a
  // credential column the fake PostgREST would refuse it exactly as Postgres
  // would, and status would fail rather than leak.
  for (const c of core.SAFE_COLUMNS.split(',')) {
    expect(SERVICE_ONLY.includes(c.trim()), `${c} is service-role only`).toBe(false);
  }
  const r = await invoke('status', { token: 'tok-a' });
  expect(r.body.ok).toBe(true);
});

test('sealing round-trips, and refuses to store anything when no key is set', () => {
  const sealed = core.seal(PLAINTEXT_TOKEN);
  expect(sealed).not.toContain(PLAINTEXT_TOKEN);
  expect(sealed.startsWith('v1:')).toBe(true);
  expect(core.unseal(sealed)).toBe(PLAINTEXT_TOKEN);

  const saved = process.env.PAYMENTS_ENCRYPTION_KEY;
  delete process.env.PAYMENTS_ENCRYPTION_KEY;
  try {
    // Failing closed is the point. Storing plaintext because a key is missing
    // would be the single worst outcome available here.
    expect(() => core.seal('anything')).toThrow(/payments_encryption_key_missing/);
    expect(core.unseal(sealed)).toBe(null);
  } finally {
    process.env.PAYMENTS_ENCRYPTION_KEY = saved;
  }
});

test('masking and redaction keep credential material out of anything printable', () => {
  expect(core.maskHint('sk_live_abcdefgh1234')).toBe('****1234');
  expect(core.maskHint('sk_live_abcdefgh1234')).not.toContain('sk_live');

  const red = core.redact({ client_secret: PLAINTEXT_TOKEN, access_token: PLAINTEXT_TOKEN, nested: { api_key: PLAINTEXT_TOKEN, keep: 'visible' } });
  expect(JSON.stringify(red)).not.toContain(PLAINTEXT_TOKEN);
  expect(red.nested.keep).toBe('visible');

  expect(core.redactUrl('https://x.test/a?client_secret=' + PLAINTEXT_TOKEN + '&b=1'))
    .toBe('https://x.test/a?client_secret=[redacted]&b=1');
});

/* ── 3. one workspace cannot read another's ──────────────────────────────── */

test('a member of one brand cannot name another brand and read its connection', async () => {
  const r = await invoke('status', { token: 'tok-b', body: { workspace_id: 'ws-a' } });
  expect(r.status).toBe(403);
  expect(r.body.error).toBe('workspace_not_visible');
  expect(JSON.stringify(r.body)).not.toContain('acct_A');
});

test('a brand sees only its own connections, never a sibling brand\'s', async () => {
  const a = await invoke('status', { token: 'tok-a' });
  expect(a.body.workspace.id).toBe('ws-a');
  expect(Object.keys(a.body.connections)).toEqual(['stripe']);

  const b = await invoke('status', { token: 'tok-b' });
  expect(b.body.workspace.id).toBe('ws-b');
  expect(Object.keys(b.body.connections)).toEqual([]);
  expect(JSON.stringify(b.body.connections)).not.toContain('acct_A');
});

test('every mutating op refuses a workspace the caller cannot see', async () => {
  for (const op of ['connect', 'probe', 'disconnect', 'save-credentials']) {
    const r = await invoke(op, { token: 'tok-b', body: { gateway: 'stripe', workspace_id: 'ws-a', credentials: {} } });
    expect(r.status, `${op} must refuse a foreign workspace`).toBe(403);
    expect(r.body.error).toBe('workspace_not_visible');
  }
  // And the foreign connection is untouched.
  expect(CONNECTIONS.filter((c) => c.workspace_id === 'ws-a')).toHaveLength(1);
});

test('an unsigned request gets nothing beyond the provider reference', async () => {
  const r = await invoke('status', {});
  expect(r.status).toBe(401);
  expect(r.body.ok).toBe(false);
});

/* ── 4. the callback is bound to whoever started the flow ────────────────── */

test('an authorization code cannot be redeemed with a state the caller did not issue', async () => {
  process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_test_client';
  try {
    const begun = await invoke('connect', { token: 'tok-a', body: { gateway: 'stripe' } });
    expect(begun.body.mode).toBe('redirect');
    const state = begun.body.state;
    expect(state).toBeTruthy();

    // Brand B tries to spend brand A's state. The RLS policy scopes the state
    // row to its issuer, so it is simply not found.
    const stolen = await invoke('callback', { token: 'tok-b', body: { gateway: 'stripe', code: 'ac_1', state } });
    expect(stolen.body.error).toBe('oauth_state_unknown');

    // The issuer can use it once. STRIPE_SECRET_KEY is unset, so the exchange
    // degrades to a stub rather than calling out, which is the point.
    const first = await invoke('callback', { token: 'tok-a', body: { gateway: 'stripe', code: 'ac_1', state } });
    expect(first.body).toHaveProperty('would_request');
    expect(first.body.would_request.url).toBe('https://connect.stripe.com/oauth/token');

    // And not twice. A replayed code is how an intercepted one gets re-bound.
    const replay = await invoke('callback', { token: 'tok-a', body: { gateway: 'stripe', code: 'ac_1', state } });
    expect(replay.body.error).toBe('oauth_state_already_used');
  } finally {
    delete process.env.STRIPE_CONNECT_CLIENT_ID;
  }
});

test('two callbacks racing on one state produce exactly one exchange', async () => {
  // Checking consumed_at and then writing it are two round trips, so a
  // sequential guard lets both of a pair of simultaneous callbacks through -
  // which is the replay the guard exists to stop. The claim has to be the
  // database's decision, not the server's.
  process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_test_client';
  try {
    const begun = await invoke('connect', { token: 'tok-a', body: { gateway: 'stripe' } });
    const state = begun.body.state;

    const both = await Promise.all([
      invoke('callback', { token: 'tok-a', body: { gateway: 'stripe', code: 'ac_race', state } }),
      invoke('callback', { token: 'tok-a', body: { gateway: 'stripe', code: 'ac_race', state } }),
    ]);
    const won = both.filter((r) => r.body && r.body.would_request);
    const lost = both.filter((r) => r.body && r.body.error === 'oauth_state_already_used');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
  } finally {
    delete process.env.STRIPE_CONNECT_CLIENT_ID;
  }
});

test('a Shopify callback with a tampered query is rejected before any exchange', () => {
  const secret = 'app-secret';
  const query = { code: 'abc', shop: 'demo-store.myshopify.com', timestamp: '1700000000' };
  const digest = crypto.createHmac('sha256', secret)
    .update(Object.keys(query).sort().map((k) => `${k}=${query[k]}`).join('&'))
    .digest('hex');

  expect(core.verifyShopifyCallback(Object.assign({ hmac: digest }, query), secret)).toBe(true);
  expect(core.verifyShopifyCallback(Object.assign({ hmac: digest }, query, { shop: 'evil.myshopify.com' }), secret)).toBe(false);
  expect(core.verifyShopifyCallback(Object.assign({ hmac: 'deadbeef' }, query), secret)).toBe(false);
});

test('a shop domain is only ever accepted when it is a real myshopify host', () => {
  expect(core.normalizeShop('Demo-Store.myshopify.com')).toBe('demo-store.myshopify.com');
  expect(core.normalizeShop('https://demo-store.myshopify.com/admin')).toBe('demo-store.myshopify.com');
  // The value comes from a text box, so it is attacker-controlled until proven
  // otherwise. Anything that is not a myshopify host is refused outright.
  for (const bad of ['evil.com', '127.0.0.1', 'demo.myshopify.com.evil.com', 'http://localhost:8080', '']) {
    expect(core.normalizeShop(bad), bad).toBe('');
  }
});

/* ── 5. the page ─────────────────────────────────────────────────────────── */

const TABS = ['gateways', 'flows', 'custody', 'pci', 'hooks', 'setup', 'gaps'];

test('the page renders every gateway and every tab with no page errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));

  await page.goto(base + '/payments.html', { waitUntil: 'load' });
  await expect(page.locator('.gw')).toHaveCount(4, { timeout: 15000 });

  // Signed out, so the reference is complete and the connect actions are not
  // usable. Both halves of that are visible, which is the honest state.
  await expect(page.locator('.gw[data-gw="stripe"]')).toContainText('Stripe');
  await expect(page.locator('.gw[data-gw="shopify_payments"]')).toContainText('Read this first');

  for (const name of TABS) {
    await page.locator(`#pay-tabs [data-tab="${name}"]`).click();
    await expect(page.locator(`#panel-${name}`)).toBeVisible();
    await expect(page.locator('.panel.on')).toHaveCount(1);
    const text = (await page.locator(`#panel-${name}`).innerText()).trim();
    expect(text.length, `panel ${name} rendered empty`).toBeGreaterThan(80);
  }

  // The standing rule for this product: a bar of controls slides sideways, it
  // never wraps onto a second line.
  const wrap = await page.locator('#pay-tabs').evaluate((el) => getComputedStyle(el).flexWrap);
  expect(wrap, 'the gateway tab bar wraps instead of sliding').toBe('nowrap');
  const rowWrap = await page.locator('.gw[data-gw="stripe"] .row').last().evaluate((el) => getComputedStyle(el).flexWrap);
  expect(rowWrap, 'the gateway action row wraps instead of sliding').toBe('nowrap');

  expect(errors).toEqual([]);
});

test('the page shows a would_request rather than a silent failure when nothing is configured', async ({ page }) => {
  await page.goto(base + '/payments.html', { waitUntil: 'load' });
  await expect(page.locator('.gw')).toHaveCount(4, { timeout: 15000 });

  await page.locator('.gw[data-gw="stripe"] [data-act="probe"]').click();
  const out = page.locator('#out-stripe');
  await expect(out).toBeVisible();
  // Signed out, the router answers 401 and the page prints that answer. Either
  // way the operator sees a specific reason, never a dead button.
  await expect(out).toContainText(/would_request|sign_in_required/, { timeout: 10000 });
});
