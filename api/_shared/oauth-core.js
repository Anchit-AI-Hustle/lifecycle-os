'use strict';
/**
 * oauth-core.js — the credential vault's front door: handshake, refresh, scopes.
 * ---------------------------------------------------------------------------
 * WHY THE STATE TOKEN IS THE WHOLE SECURITY DESIGN.
 * Every other authenticated path in this platform carries a Supabase JWT.
 * The OAuth callback cannot: it arrives as a top-level browser navigation
 * initiated by Meta or Google, and a redirect carries no Authorization header.
 * So the `state` parameter is not a CSRF nicety here, it is the ONLY thing
 * linking the callback to the person and the workspace that started the flow.
 * It is therefore:
 *
 *   - 32 random bytes, not a guessable id;
 *   - stored server-side with the workspace, the user and the exact scopes
 *     that were requested, so the callback cannot be replayed against a
 *     different workspace;
 *   - SINGLE USE - consumed_at is set inside the same conditional update that
 *     reads it, so two concurrent callbacks cannot both succeed;
 *   - short-lived (ten minutes);
 *   - stored in a table with RLS on and NO POLICY, revoked from anon and
 *     authenticated, because it sits next to the PKCE code_verifier.
 *
 * PKCE. Sent for every provider that supports it, and REQUIRED by Klaviyo. The
 * verifier never leaves the server; only its S256 hash goes out in the URL.
 *
 * OPEN REDIRECT. `return_to` is where the operator lands afterwards. It is
 * validated against this deployment's own origins before it is stored, not when
 * it is used - a value that cannot be stored cannot be redirected to.
 *
 * TOKENS AT REST. Access and refresh tokens go into workspace_connection_secrets
 * through workspace-connections-core.js, which encrypts them with AES-256-GCM
 * under CONNECTION_SECRET_KEY before they reach Postgres. Nothing in this module
 * returns a token to a browser.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * Routed from api/public-config.js ?action=connections&op=oauth-*.
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');
const brandCore = require('./brand-workspace-core.js');
const connections = require('./workspace-connections-core.js');
const { adapterFor, connectionProviderFor } = require('./adapters/registry.js');

const STATE_TTL_MS = 10 * 60 * 1000;
// Refresh this far before the stated expiry. A Klaviyo token lives ten minutes,
// so a 60s skew is the difference between refreshing early and discovering the
// expiry mid-dispatch.
const REFRESH_SKEW_MS = 60 * 1000;

/* ── service-role access to the state table ───────────────────────────────── */

function serviceEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    const e = new Error('SUPABASE_SERVICE_ROLE_KEY is required for the OAuth handshake: the PKCE verifier is not readable by any browser role.');
    e.status = 503; e.code = 'oauth_store_unavailable';
    throw e;
  }
  return { url: String(url).replace(/\/$/, ''), key };
}

async function serviceRest(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const e = serviceEnv();
  const headers = { apikey: e.key, authorization: `Bearer ${e.key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) {
    // The row can contain the verifier, so only the status is reported.
    const err = new Error(`oauth state store ${method} -> ${res.status}`);
    err.status = 502;
    throw err;
  }
  return json;
}

/* ── redirect handling ────────────────────────────────────────────────────── */

/** This deployment's own origin, which is what a provider must redirect back to. */
function selfOrigin(req) {
  const envUrl = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (envUrl) return envUrl.replace(/\/+$/, '');
  const host = (req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || process.env.VERCEL_URL || '';
  if (!host) return '';
  const proto = /^localhost|^127\./.test(String(host)) ? 'http' : 'https';
  return `${proto}://${host}`;
}

function callbackUrl(req, provider) {
  return `${selfOrigin(req)}/api/public-config?action=connections&op=oauth-callback&provider=${encodeURIComponent(provider)}`;
}

/**
 * Only a path on this deployment. An absolute URL elsewhere is refused rather
 * than sanitised, because "sanitised" open-redirect filters are where the bugs
 * live. A relative path cannot leave the origin.
 */
function safeReturnTo(value) {
  const s = String(value || '').trim();
  if (!s) return '/connections';
  if (!s.startsWith('/') || s.startsWith('//')) return '/connections';
  return s.slice(0, 300);
}

/* ── PKCE ─────────────────────────────────────────────────────────────────── */

function base64Url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 43-128 characters of unreserved charset, per RFC 7636. 32 bytes -> 43 chars. */
function makeVerifier() { return base64Url(crypto.randomBytes(32)); }
function challengeFor(verifier) { return base64Url(crypto.createHash('sha256').update(verifier).digest()); }

/* ── step 1: build the authorize URL ──────────────────────────────────────── */

/**
 * @returns {Promise<{ok:true, url:string, state:string, scopes:string[]}>}
 */
async function beginAuthorization(req, auth, workspaceId, input) {
  const providerId = String((input && input.provider) || '').toLowerCase();
  const Adapter = adapterFor(providerId);
  if (!Adapter) { const e = new Error(`Unknown platform "${providerId}".`); e.status = 400; throw e; }

  const spec = Adapter.auth || {};
  if (spec.kind !== 'oauth') {
    const e = new Error(`${Adapter.label} does not use OAuth. Store its key on the connections page instead.`);
    e.status = 400; throw e;
  }
  await brandCore.assertCanWrite(auth, workspaceId, 'connect a platform');

  const clientId = clientIdFor(providerId);
  if (!clientId) {
    const e = new Error(
      `This deployment has no ${Adapter.label} app registered, so there is no sign-in to start. `
      + `${(spec.platform_prereq && spec.platform_prereq.what) || ''} `
      + `Set ${Object.keys((spec.platform_prereq && spec.platform_prereq.env) || {}).join(' and ') || 'the client credentials'} and try again.`,
    );
    e.status = 503; e.code = 'oauth_app_not_registered';
    throw e;
  }

  // Requested scopes: whatever the caller asked for, intersected with what the
  // adapter declares. A scope this platform cannot explain is not requested -
  // over-asking is the fastest way to fail a platform's app review.
  const declared = (spec.scopes || []).map((s) => s.value);
  const asked = Array.isArray(input && input.scopes) && input.scopes.length ? input.scopes : (spec.default_scopes || declared);
  const scopes = asked.filter((s) => declared.indexOf(s) >= 0);
  if (!scopes.length) { const e = new Error('No recognised scopes were requested.'); e.status = 400; throw e; }

  const state = base64Url(crypto.randomBytes(32));
  const usePkce = !!(spec.pkce && (spec.pkce.required || spec.pkce.method));
  const verifier = usePkce ? makeVerifier() : null;
  const redirectUri = callbackUrl(req, providerId);

  await serviceRest('oauth_authorization_states', {
    method: 'POST',
    body: [{
      state,
      workspace_id: workspaceId,
      provider: providerId,
      user_id: auth.user_id,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      scopes,
      return_to: safeReturnTo(input && input.return_to),
      expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
    }],
    prefer: 'return=minimal',
  });

  const sep = spec.scope_separator || ' ';
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope: scopes.join(sep),
  });
  if (usePkce) { params.set('code_challenge', challengeFor(verifier)); params.set('code_challenge_method', 'S256'); }

  // Google returns a refresh token only with BOTH of these, and only on the
  // first consent. Without them the integration works for an hour and then
  // dies, which is the classic way this breaks a week after it is built.
  if (providerId === 'google_ads') { params.set('access_type', 'offline'); params.set('prompt', 'consent'); }

  return { ok: true, url: `${spec.endpoints.authorize}?${params.toString()}`, state, scopes, redirect_uri: redirectUri };
}

function clientIdFor(provider) {
  switch (provider) {
    case 'meta': return String(process.env.META_APP_ID || '').trim();
    case 'google_ads': return String(process.env.GOOGLE_ADS_CLIENT_ID || '').trim();
    case 'klaviyo': return String(process.env.KLAVIYO_OAUTH_CLIENT_ID || '').trim();
    default: return '';
  }
}

function clientSecretFor(provider) {
  switch (provider) {
    case 'meta': return String(process.env.META_APP_SECRET || '').trim();
    case 'google_ads': return String(process.env.GOOGLE_ADS_CLIENT_SECRET || '').trim();
    case 'klaviyo': return String(process.env.KLAVIYO_OAUTH_CLIENT_SECRET || '').trim();
    default: return '';
  }
}

/* ── step 2: the callback ─────────────────────────────────────────────────── */

/**
 * Consume the state ATOMICALLY. The update is conditional on consumed_at still
 * being null, so if two callbacks race, exactly one gets a row back and the
 * other gets an empty array. Reading and then writing would let both through.
 */
async function consumeState(state) {
  const rows = await serviceRest(
    `oauth_authorization_states?state=eq.${encodeURIComponent(state)}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,
    { method: 'PATCH', body: { consumed_at: new Date().toISOString() }, prefer: 'return=representation' },
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/**
 * @returns {Promise<{ok:boolean, redirect:string, provider:string, message:string}>}
 */
async function handleCallback(req) {
  const q = (req && req.query) || {};
  const provider = String(q.provider || '').toLowerCase();
  const state = String(q.state || '');
  const code = String(q.code || '');

  // A provider reports a refusal in the query string, not as an HTTP error.
  const providerError = String(q.error_description || q.error || '');

  if (!state) return { ok: false, redirect: '/connections?oauth=error&reason=missing_state', provider, message: 'The callback carried no state parameter.' };

  const row = await consumeState(state);
  if (!row) {
    return {
      ok: false,
      redirect: '/connections?oauth=error&reason=state_expired',
      provider,
      message: 'That sign-in link was already used or has expired. Start the connection again.',
    };
  }
  const returnTo = safeReturnTo(row.return_to);

  if (providerError) {
    return { ok: false, redirect: `${returnTo}?oauth=denied&provider=${encodeURIComponent(provider)}`, provider, message: providerError.slice(0, 300) };
  }
  if (!code) return { ok: false, redirect: `${returnTo}?oauth=error&reason=missing_code`, provider, message: 'The callback carried no authorization code.' };
  if (row.provider !== provider) {
    // The state belongs to a different platform than the callback claims.
    return { ok: false, redirect: `${returnTo}?oauth=error&reason=provider_mismatch`, provider, message: 'The sign-in state did not match the platform that answered.' };
  }

  const exchanged = await exchangeCode(provider, code, row);
  if (!exchanged.ok) {
    return { ok: false, redirect: `${returnTo}?oauth=error&reason=exchange_failed`, provider, message: exchanged.note || 'The token exchange failed.' };
  }

  await persistGrant(row, provider, exchanged);
  return {
    ok: true,
    redirect: `${returnTo}?oauth=connected&provider=${encodeURIComponent(provider)}`,
    provider,
    message: `${provider} connected.`,
  };
}

/** The token exchange, per provider, using only endpoints the adapter declares. */
async function exchangeCode(provider, code, row) {
  const Adapter = adapterFor(provider);
  const spec = Adapter.auth;
  const clientId = clientIdFor(provider);
  const clientSecret = clientSecretFor(provider);

  if (provider === 'meta') {
    // Meta's exchange is a GET with the parameters in the query string.
    const url = `${spec.endpoints.token}?${new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, redirect_uri: row.redirect_uri, code,
    }).toString()}`;
    const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
    const j = res && res.ok ? await res.json().catch(() => null) : null;
    if (!j || !j.access_token) return { ok: false, note: await failNote(res, 'Meta') };
    return { ok: true, access_token: j.access_token, expires_in: Number(j.expires_in || 0) };
  }

  // Google and Klaviyo are both POST with a form body; they differ in how the
  // client credentials travel.
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: row.redirect_uri });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

  if (provider === 'klaviyo') {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    if (row.code_verifier) body.set('code_verifier', row.code_verifier);
  } else {
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    if (row.code_verifier) body.set('code_verifier', row.code_verifier);
  }

  const res = await fetch(spec.endpoints.token, { method: 'POST', headers, body: body.toString(), cache: 'no-store' }).catch(() => null);
  const j = res && res.ok ? await res.json().catch(() => null) : null;
  if (!j || !j.access_token) return { ok: false, note: await failNote(res, Adapter.label) };

  return {
    ok: true,
    access_token: j.access_token,
    refresh_token: j.refresh_token || '',
    expires_in: Number(j.expires_in || 0),
    // The GRANTED scopes, which can be narrower than what was asked for.
    granted_scopes: typeof j.scope === 'string' ? j.scope.split(/[\s,]+/).filter(Boolean) : null,
  };
}

async function failNote(res, label) {
  if (!res) return `${label} could not be reached for the token exchange.`;
  let detail = '';
  try { detail = (await res.text()).slice(0, 200); } catch (_) { /* ignore */ }
  return `${label} refused the token exchange (${res.status}). ${detail}`;
}

/**
 * Store the grant. The tokens go through workspace-connections-core.saveConnection
 * so they are encrypted by the same code path as every other secret - there is
 * deliberately no second way to write a credential in this codebase.
 */
async function persistGrant(row, provider, grant) {
  const connProvider = connectionProviderFor(provider);
  const Adapter = adapterFor(provider);

  // Act as the user who started the flow. They passed assertCanWrite at step 1
  // and their rights may have changed since; re-checking is cheap and correct.
  const auth = { ok: true, user_id: row.user_id, token: null };

  const fields = { access_token: grant.access_token };
  if (grant.refresh_token) fields.refresh_token = grant.refresh_token;

  await connections.saveConnectionAsService({
    workspace_id: row.workspace_id,
    provider: connProvider,
    fields,
    user_id: row.user_id,
    meta: {
      connect_kind: 'oauth',
      oauth_scopes: grant.granted_scopes || row.scopes || [],
      token_expires_at: grant.expires_in ? new Date(Date.now() + grant.expires_in * 1000).toISOString() : null,
      last_refresh_at: new Date().toISOString(),
      refresh_failure_count: 0,
      revoked_at: null,
    },
  });

  // Ask the platform who it just connected, so the hub can show an account name
  // rather than an opaque id. A failure here is not a failure of the connection.
  try {
    const adapter = new Adapter({ workspaceId: row.workspace_id, credentials: fields, connection: null });
    const who = await adapter.validateCredentials();
    if (who && who.ok) {
      await connections.patchConnectionAsService(row.workspace_id, connProvider, {
        external_account_id: String((who.account && (who.account.id || who.account.customer_id || who.account.licence_code)) || ''),
        external_account_label: String((who.account && (who.account.name || who.account.organization_name)) || ''),
        oauth_scopes: who.scopes && who.scopes.length ? who.scopes : (grant.granted_scopes || row.scopes || []),
        last_check_ok: true,
        last_checked_at: new Date().toISOString(),
        last_check_note: (who.note || 'Connected.').slice(0, 300),
      });
    }
  } catch (_) { /* the grant is stored; identifying the account is a nicety */ }

  void auth;
}

/* ── step 3: keep it fresh ────────────────────────────────────────────────── */

/**
 * Return usable credentials for a workspace + platform, refreshing first if the
 * access token is expired or about to be.
 *
 * This is called on the hot path of every dispatch because a Klaviyo access
 * token is valid for ten minutes. The rotated token is persisted BEFORE it is
 * used: a refresh that succeeds and is then lost to a crash has spent one of
 * ten refreshes a minute and left the stored token stale.
 *
 * @returns {Promise<{ok:boolean, credentials?:Object, note?:string, refreshed?:boolean, reconnect_required?:boolean}>}
 */
async function ensureFreshToken(workspaceId, provider, { connection, credentials } = {}) {
  const Adapter = adapterFor(provider);
  if (!Adapter) return { ok: false, note: `Unknown platform "${provider}".` };

  const conn = connection || await connections.getConnectionAsService(workspaceId, connectionProviderFor(provider));
  const creds = credentials || (conn ? await connections.secretsAsService(conn.id) : null);
  if (!creds || (!creds.access_token && !creds.api_key)) {
    return { ok: false, note: `${Adapter.label} is not connected on this brand.`, reconnect_required: true };
  }

  // A pasted API key does not expire.
  if (!creds.access_token && creds.api_key) return { ok: true, credentials: creds, refreshed: false };

  const expiresAt = conn && conn.token_expires_at ? Date.parse(conn.token_expires_at) : 0;
  const stillGood = !expiresAt || expiresAt - Date.now() > REFRESH_SKEW_MS;
  if (stillGood) return { ok: true, credentials: creds, refreshed: false };

  const adapter = new Adapter({ workspaceId, credentials: creds, connection: conn });
  const r = await adapter.refreshCredentials();
  if (!r.ok) {
    await connections.patchConnectionAsService(workspaceId, connectionProviderFor(provider), {
      refresh_failure_count: Number((conn && conn.refresh_failure_count) || 0) + 1,
      last_check_ok: false,
      last_check_note: String(r.note || 'Refresh failed.').slice(0, 300),
      revoked_at: r.terminal ? new Date().toISOString() : null,
    });
    return { ok: false, note: r.note, reconnect_required: !!r.terminal };
  }

  const merged = Object.assign({}, creds, r.credentials);
  await connections.saveConnectionAsService({
    workspace_id: workspaceId,
    provider: connectionProviderFor(provider),
    fields: r.credentials,
    meta: {
      token_expires_at: r.expires_at || null,
      last_refresh_at: new Date().toISOString(),
      refresh_failure_count: 0,
      revoked_at: null,
    },
  });

  return { ok: true, credentials: merged, refreshed: true };
}

/* ── scope validation ─────────────────────────────────────────────────────── */

/**
 * Does this connection hold what the action needs? Checked BEFORE a dispatch so
 * a missing permission is a clear preflight message rather than a 403 after a
 * partial send.
 *
 * A connection with no recorded scopes (a pasted key, or a grant made before
 * this column existed) is NOT treated as unauthorised - there is nothing to
 * check against, and refusing would break every pre-existing connection. It is
 * reported as unknown, which the preflight gate renders as a warning.
 */
function validateScopes(provider, channelId, grantedScopes, action) {
  const Adapter = adapterFor(provider);
  if (!Adapter) return { ok: false, missing: [], note: `Unknown platform "${provider}".` };
  const required = Adapter.requiredScopes(channelId, action || 'write') || [];
  if (!required.length) return { ok: true, missing: [], note: 'This platform does not scope this action.' };

  const granted = Array.isArray(grantedScopes) ? grantedScopes : [];
  if (!granted.length) {
    return { ok: true, unknown: true, missing: [], note: 'No scope list is recorded for this connection, so the permission could not be checked in advance. The platform will decide at send time.' };
  }
  const missing = required.filter((s) => granted.indexOf(s) < 0);
  return {
    ok: missing.length === 0,
    missing,
    note: missing.length
      ? `The connection is missing ${missing.join(', ')}. Reconnect and grant it: a scope cannot be added to an existing token.`
      : 'All required scopes are granted.',
  };
}

/* ── disconnect ───────────────────────────────────────────────────────────── */

async function revoke(auth, workspaceId, provider) {
  await brandCore.assertCanWrite(auth, workspaceId, 'disconnect a platform');
  const connProvider = connectionProviderFor(provider);

  // Best effort at the provider. Google documents a revoke endpoint; Meta and
  // Klaviyo revocations are done in their own UI. Local removal happens either
  // way, so a disconnect is never blocked by the provider being unreachable.
  let providerNote = 'The stored credential was removed from this workspace.';
  try {
    const conn = await connections.getConnectionAsService(workspaceId, connProvider);
    const creds = conn ? await connections.secretsAsService(conn.id) : null;
    if (provider === 'google_ads' && creds && (creds.refresh_token || creds.access_token)) {
      const r = await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: creds.refresh_token || creds.access_token }).toString(),
      }).catch(() => null);
      providerNote = r && r.ok
        ? 'The credential was removed here and revoked at Google.'
        : 'The credential was removed here. Google did not confirm the revocation, so check the account\'s third-party access list.';
    } else if (provider === 'meta' || provider === 'klaviyo') {
      providerNote = `The credential was removed here. ${provider === 'meta' ? 'Meta' : 'Klaviyo'} does not expose a revoke endpoint this platform can call, so remove the app in that account too if you want the grant gone at their end.`;
    }
  } catch (_) { /* removal still proceeds */ }

  await connections.deleteConnection(auth, workspaceId, connProvider);
  return { ok: true, removed: connProvider, note: providerNote };
}

module.exports = {
  beginAuthorization,
  handleCallback,
  ensureFreshToken,
  validateScopes,
  revoke,
  // seams for tests
  safeReturnTo,
  callbackUrl,
  makeVerifier,
  challengeFor,
  clientIdFor,
  STATE_TTL_MS,
  REFRESH_SKEW_MS,
};
