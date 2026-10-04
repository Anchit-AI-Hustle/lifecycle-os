'use strict';
/**
 * adapters/base-adapter.js — the contract every publishing target implements.
 * ---------------------------------------------------------------------------
 * The brief asked for `BasePlatformAdapter`, `AdPlatformAdapter` and
 * `CrmPlatformAdapter` in TypeScript. This repository is plain CommonJS with no
 * build step (`framework: null`, no tsc anywhere), so introducing .ts here would
 * mean either a compile step this deployment does not have or a second runtime
 * beside the one that works. The contract is therefore expressed as:
 *
 *   - JSDoc @typedef blocks below, which give real completion and real type
 *     checking in an editor and under `tsc --checkJs`, and
 *   - adapters/types.d.ts, a hand-written declaration file carrying the same
 *     interfaces as actual TypeScript for anything that wants to import them.
 *
 * So the types exist and are checkable; what does not exist is a transpiler in
 * the request path.
 *
 * ── WHAT AN ADAPTER MAY AND MAY NOT DO ─────────────────────────────────────
 * An adapter NEVER invents an endpoint. Every URL in a concrete adapter is
 * either already called elsewhere in this repository or was read from the
 * platform's own documentation in the session that wrote it, and each carries
 * its `sources`. Where a detail could not be confirmed it is a
 * [DATA REQUIRED BEFORE LAUNCH: …] string, because a plausible wrong endpoint
 * costs more to debug than an admitted gap. This is the same provenance rule
 * payments-core.js follows.
 *
 * An adapter NEVER decides on its own that it may write to a guarded platform.
 * read-only-egress.js is a standing project rule (Klaviyo, Shopify and
 * WebEngage are fetch-only) and publishing is exactly the write it forbids.
 * `assertPublishAllowed()` below is the ONLY door, and it needs two independent
 * keys: the deployment's per-platform escape hatch AND this workspace having
 * explicitly turned publishing on. Neither alone is enough, and a refusal is
 * reported to the operator rather than swallowed.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const { assertReadOnly, platformFor } = require('../read-only-egress.js');
const { liveConnectorsEnabled } = require('../live-connectors.js');

/* ── types ────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} AdapterCredentials
 * @property {string} [access_token]   OAuth access token, or a pasted API key.
 * @property {string} [refresh_token]
 * @property {string} [api_key]
 * @property {string} [client_id]
 * @property {string} [client_secret]
 * @property {string} [account_id]     The platform's own account identifier.
 * @property {string[]} [scopes]       Scopes the platform GRANTED, not requested.
 * @property {string} [expires_at]     ISO 8601.
 */

/**
 * @typedef {Object} DispatchContext
 * @property {string}  workspaceId
 * @property {AdapterCredentials} credentials
 * @property {Object}  [connection]    The workspace_connections row.
 * @property {boolean} [dryRun]        True => describe the call, never send it.
 * @property {boolean} [publishEnabled] Workspace has opted in to live writes.
 * @property {string}  [idempotencyKey]
 */

/**
 * @typedef {Object} DispatchResult
 * @property {boolean} ok
 * @property {boolean} [sent]          False when this was a dry run or a refusal.
 * @property {string}  [external_id]
 * @property {string}  [status]
 * @property {Object}  [would_request] Present when nothing was sent.
 * @property {string}  [error]
 * @property {'rate_limited'|'auth'|'validation'|'transient'|'permanent'|'blocked'} [error_class]
 * @property {number}  [retry_after_ms]
 * @property {Object}  [raw]
 */

/**
 * @typedef {Object} MappingResult
 * @property {boolean}  ok
 * @property {Object}   payload
 * @property {string[]} warnings
 * @property {string[]} missing      [DATA REQUIRED BEFORE LAUNCH] style gaps.
 */

/* ── error classification ─────────────────────────────────────────────────── */

/**
 * Turn an HTTP status into a retry decision. This is the single place the queue
 * consults, so "is this worth retrying" is answered the same way for every
 * platform rather than per-adapter folklore.
 *
 * 408/429/5xx are transient. 401/403 are auth: retrying an expired token is
 * pointless, but refreshing it and retrying once is not, so it is its own class.
 * 4xx otherwise is permanent - the payload is wrong and will still be wrong in
 * eight minutes.
 */
function classifyStatus(status, body) {
  const s = Number(status) || 0;
  if (s === 429) return 'rate_limited';
  if (s === 401 || s === 403) return 'auth';
  if (s === 408 || s === 425 || s >= 500) return 'transient';
  if (s === 0) return 'transient';                    // no answer at all: a network blip
  if (s >= 400) {
    // A few platforms report a throttle as a 400 with a code in the body, the
    // same way OpenAI reports a hard billing limit as a 400. Read the body
    // before calling it permanent.
    const t = typeof body === 'string' ? body : JSON.stringify(body || '');
    if (/rate.?limit|too many requests|throttl/i.test(t)) return 'rate_limited';
    return 'permanent';
  }
  return 'permanent';
}

/** Seconds a platform asked us to wait, from whichever header it used. */
function retryAfterMs(headers) {
  if (!headers) return 0;
  const get = (k) => (typeof headers.get === 'function' ? headers.get(k) : headers[k]);
  const raw = get('retry-after') || get('Retry-After') || get('x-ratelimit-reset') || '';
  if (!raw) return 0;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n < 10000 ? n * 1000 : n;   // seconds vs epoch-ish
  const when = Date.parse(raw);
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : 0;
}

/* ── the publish gate ─────────────────────────────────────────────────────── */

/**
 * May this adapter actually send?
 *
 * Three independent conditions, and the caller is told WHICH one refused rather
 * than getting a generic false:
 *
 *   1. LIVE_CONNECTORS must be on. This is the repo-wide kill switch and it is
 *      off by default; with it off nothing in this platform opens a live
 *      outbound connection.
 *   2. The workspace must have turned publishing on for itself. A stored
 *      credential is permission to READ; sending as somebody's brand is a
 *      separate, explicit decision.
 *   3. For klaviyo / shopify / webengage: the deployment's per-platform
 *      escape hatch (<PLATFORM>_ALLOW_WRITES=1) must be set, because those three
 *      are covered by the standing read-only rule and an adapter is not
 *      entitled to decide that rule does not apply to it. For the social
 *      gateway platforms (Meta, TikTok, Pinterest, YouTube) the adapter's own
 *      `writeSwitch` (META_ALLOW_WRITES, ...) plays the same part
 *      (2026-10-04): a post, a reply or an ad is a write to a public account.
 *
 * Returns { allowed, reason, blocker } and never throws, so a refusal becomes a
 * job the operator can see and act on rather than a stack trace.
 */
function publishAllowance(url, ctx) {
  const c = ctx || {};
  if (c.dryRun) return { allowed: false, reason: 'dry_run', blocker: 'Dry run: the request was built and not sent.' };

  if (!liveConnectorsEnabled()) {
    return {
      allowed: false,
      reason: 'live_connectors_off',
      blocker: 'LIVE_CONNECTORS is off on this deployment, which is the default. Nothing here opens a live outbound connection until it is set to "on".',
    };
  }

  if (!c.publishEnabled) {
    return {
      allowed: false,
      reason: 'workspace_publishing_off',
      blocker: 'This brand has not enabled live publishing. A stored credential lets this platform read; sending as the brand is a separate switch on the connection.',
    };
  }

  const guarded = platformFor(url);
  if (guarded && process.env[guarded.allowEnv] !== '1') {
    return {
      allowed: false,
      reason: 'read_only_egress',
      blocker: `${guarded.id} is fetch-only under this project's standing read-only rule. Set ${guarded.allowEnv}=1 on the deployment to permit writes to it.`,
    };
  }

  // The THIRD switch for the social gateway platforms (2026-10-04). A platform
  // the read-only rule does not cover still gets a deployment-level write switch
  // of its own (META_ALLOW_WRITES, TIKTOK_ALLOW_WRITES, PINTEREST_ALLOW_WRITES,
  // YOUTUBE_ALLOW_WRITES): posting, replying to a customer and creating an ad
  // are writes to somebody's public account, and the deployment decides that
  // they may happen at all - not the adapter, and not the workspace alone. Off
  // by default. The adapter passes its own switch through send(); a caller that
  // passes none (an unguarded URL checked on its own) is unaffected.
  const sw = c.writeSwitch ? String(c.writeSwitch) : '';
  if (sw && process.env[sw] !== '1') {
    return {
      allowed: false,
      reason: 'platform_writes_off',
      blocker: `${c.platformLabel || 'This platform'} writes are off on this deployment. Set ${sw}=1 to permit them; it is off by default so nothing is posted, replied to or created on the account until the deployment decides it may be.`,
    };
  }

  return { allowed: true, reason: 'allowed', blocker: '' };
}

/* ── endpoint tables ──────────────────────────────────────────────────────── */

/**
 * The social gateway adapters declare every call they make in one table:
 *
 *   { op: { method, url, verified, doc, scopes?, read?, note? } }
 *
 * `url` may carry `{name}` placeholders, filled from `params` and encoded.
 * `verified` is TRUE only when the endpoint was read in the platform's own
 * documentation in the session that wrote it, and `doc` names the page. Any
 * other value - false, missing, a typo - is treated as unverified and the call
 * is REFUSED with the exact request it would have made. Fail closed: an entry
 * that forgot the flag is not a verified one.
 *
 * `read: true` marks a POST the platform documents as a READ (TikTok's
 * /v2/video/list/ is a POST). It is not subject to the publish gate, but like
 * every read here it is subject to LIVE_CONNECTORS.
 */
function fillUrl(template, params, query) {
  const p = params || {};
  let missing = '';
  const url = String(template || '').replace(/\{([a-z_]+)\}/gi, (_m, name) => {
    const v = p[name];
    if (v == null || v === '') { missing = missing || name; return ''; }
    return encodeURIComponent(String(v));
  });
  if (missing) return { ok: false, error: `The ${missing.replace(/_/g, ' ')} is required for this call and was not supplied.` };
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)])).toString() : '';
  return { ok: true, url: qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url };
}

/** A URL as it may be shown: no token, no proof, in any query string. */
function redactUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (SECRET_KEYS.test(k) || /^appsecret_proof$/i.test(k)) u.searchParams.set(k, '[redacted]');
    return u.toString();
  } catch (_) { return String(url || ''); }
}

/** A gateway reader's "not supported here" envelope. Never an empty success. */
function unsupported(label, what, why) {
  return { ok: false, supported: false, note: `${label} does not offer ${what} through this platform. ${why || ''}`.trim() };
}

/* ── the base class ───────────────────────────────────────────────────────── */

class BasePlatformAdapter {
  /** @param {DispatchContext} ctx */
  constructor(ctx) {
    /** @type {DispatchContext} */
    this.ctx = ctx || /** @type {any} */ ({});
    this.credentials = this.ctx.credentials || {};
    this.workspaceId = this.ctx.workspaceId || '';
  }

  /* — identity, overridden by every concrete adapter — */
  static get id() { throw new Error('adapter must declare an id'); }
  static get label() { return this.id; }
  static get category() { return 'other'; }        // 'ads' | 'crm' | 'social'
  /** @returns {Array<{id:string,label:string,asset_kinds:string[],constraints:Object}>} */
  static get channels() { return []; }
  /** Auth shape, endpoints, scopes and their provenance. */
  static get auth() { return { kind: 'api_key', endpoints: {}, scopes: [], sources: [] }; }

  /** Channel descriptor by id, or null. */
  static channel(id) { return this.channels.find((c) => c.id === id) || null; }

  /**
   * The deployment's per-platform write switch, or null when the platform has
   * none beyond the standing read-only rule. See publishAllowance().
   */
  static get writeSwitch() { return null; }

  /** `{ op: {method, url, verified, doc, ...} }` - see fillUrl() above. */
  static get endpointTable() { return {}; }

  /** One endpoint descriptor, or null. */
  static endpointFor(op) { return this.endpointTable[op] || null; }

  /**
   * Scopes an action needs. The queue checks this against the scopes the
   * platform actually GRANTED before it tries, so a missing permission is a
   * clear message at preflight instead of a 403 after a partial send.
   * @returns {string[]}
   */
  static requiredScopes(_channelId, _action) { return []; }

  /* — the contract — */

  /** @returns {Promise<{ok:boolean, account?:Object, scopes?:string[], note?:string}>} */
  async validateCredentials() { return { ok: false, note: 'not implemented' }; }

  /**
   * Exchange a refresh token for a new access token.
   * @returns {Promise<{ok:boolean, supported:boolean, credentials?:AdapterCredentials, expires_at?:string, note?:string}>}
   */
  async refreshCredentials() { return { ok: false, supported: false, note: 'This platform does not use refresh tokens.' }; }

  /**
   * Asset + mapping -> platform payload. Pure: no network, no clock, no
   * randomness, so the same asset always produces the same payload and the
   * idempotency key derived from it is stable.
   * @returns {MappingResult}
   */
  map(_asset, _mapping) { return { ok: false, payload: {}, warnings: [], missing: ['adapter did not implement map()'] }; }

  /** @returns {{ok:boolean, errors:string[], warnings:string[]}} */
  validatePayload(_channelId, _payload) { return { ok: true, errors: [], warnings: [] }; }

  /** @returns {Promise<DispatchResult>} */
  async dispatch(_channelId, _payload) { return { ok: false, error: 'not implemented', error_class: 'permanent' }; }

  /** @returns {Promise<{ok:boolean, status?:string, detail?:Object}>} */
  async fetchStatus(_externalId) { return { ok: false, detail: { note: 'This platform has no status read wired.' } }; }

  /**
   * @returns {{verified:boolean, note:string, event?:Object}}
   * A false here must never be upgraded by a caller: an unverified webhook is
   * stored for diagnosis and never acted on.
   */
  verifyWebhook(_headers, _rawBody) {
    return { verified: false, reason: 'no_signature_scheme', note: 'No signature scheme is wired for this platform, so its deliveries are refused rather than accepted unverified.' };
  }

  /**
   * A platform's verification / handshake request (a GET before any delivery).
   * No scheme by default: an answer nobody specified is not an answer.
   */
  verifyChallenge(_query) {
    return { ok: false, reason: 'no_challenge_scheme', note: 'No verification-request scheme is wired for this platform.' };
  }

  /* — helpers every adapter shares — */

  /**
   * The single outbound call. Enforces the publish gate, records what it would
   * have sent when it is not allowed to send, classifies failures, and never
   * lets a credential into the returned envelope.
   * @returns {Promise<DispatchResult>}
   */
  async send(url, { method = 'POST', headers = {}, body, timeoutMs = 20000, describeBody, rawBody, captureHeaders } = {}) {
    const shown = describeBody !== undefined ? describeBody : redact(body);
    const gate = publishAllowance(url, Object.assign({}, this.ctx, {
      writeSwitch: this.constructor.writeSwitch || null,
      platformLabel: this.constructor.label,
    }));
    if (!gate.allowed) {
      return {
        ok: false,
        sent: false,
        error: gate.blocker,
        error_class: gate.reason === 'dry_run' ? 'validation' : 'blocked',
        blocked_by: gate.reason,
        would_request: { method, url: redactUrl(url), body: shown },
      };
    }

    // Defense in depth: the gate above already checked, but the standing guard
    // is what actually throws, and it should stay the last word.
    try { assertReadOnly(url, method); } catch (err) {
      return { ok: false, sent: false, error: err.message, error_class: 'blocked', would_request: { method, url: redactUrl(url), body: shown } };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        // A raw byte body (a video upload) carries its own content type.
        headers: rawBody !== undefined ? Object.assign({}, headers) : Object.assign({ 'Content-Type': 'application/json' }, headers),
        body: rawBody !== undefined ? rawBody
          : body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
        signal: ctrl.signal,
        cache: 'no-store',
      });
      const text = await res.text();
      let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
      const picked = {};
      for (const h of Array.isArray(captureHeaders) ? captureHeaders : []) {
        const v = res.headers && (typeof res.headers.get === 'function' ? res.headers.get(h) : res.headers[h]);
        if (v) picked[String(h).toLowerCase()] = String(v);
      }
      if (!res.ok) {
        return {
          ok: false,
          sent: true,
          error: shorten(json),
          error_class: classifyStatus(res.status, json),
          retry_after_ms: retryAfterMs(res.headers),
          raw: { status: res.status },
        };
      }
      return Object.assign({ ok: true, sent: true, status: 'accepted', raw: json, http_status: res.status }, Object.keys(picked).length ? { headers: picked } : {});
    } catch (err) {
      const aborted = err && (err.name === 'AbortError' || /abort/i.test(err.message || ''));
      return {
        ok: false,
        sent: true,                                  // it may have landed; the retry needs the idempotency key
        error: aborted ? `No response within ${timeoutMs}ms.` : String((err && err.message) || err),
        error_class: 'transient',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** A GET that is never subject to the publish gate: reading is always allowed. */
  async read(url, { headers = {}, timeoutMs = 20000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal, cache: 'no-store' });
      const text = await res.text();
      let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
      return res.ok
        ? { ok: true, data: json }
        : { ok: false, status: res.status, error: shorten(json), error_class: classifyStatus(res.status, json), retry_after_ms: retryAfterMs(res.headers) };
    } catch (err) {
      return { ok: false, status: 0, error: String((err && err.message) || err), error_class: 'transient' };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Call one entry of the adapter's endpoint table. The single door every
   * social gateway call goes through, and it decides, in this order:
   *
   *   1. the op exists and its URL can be built from what was supplied;
   *   2. the endpoint is VERIFIED - anything else is refused with the exact
   *      request, so an unconfirmed path never reaches a platform;
   *   3. a READ (GET, or a POST the platform documents as a read) needs only
   *      LIVE_CONNECTORS: reading is not publishing, and the publish switches
   *      do not apply to it;
   *   4. a WRITE goes through send(), and therefore through all three switches.
   *
   * Returns the DispatchResult shape, with the parsed body on `data` as well as
   * `raw`, and `doc` naming where the endpoint came from.
   */
  async callEndpoint(op, { params, query, body, headers = {}, describeBody, timeoutMs, rawBody, captureHeaders } = {}) {
    const A = this.constructor;
    const ep = A.endpointFor(op);
    if (!ep) return { ok: false, sent: false, error: `No endpoint "${op}" is declared for ${A.label}.`, error_class: 'permanent' };
    const built = fillUrl(ep.url, params, query);
    if (!built.ok) return { ok: false, sent: false, error: built.error, error_class: 'validation', op };
    const url = built.url;
    const shown = describeBody !== undefined ? describeBody : redact(body);
    const would = { method: ep.method, url: redactUrl(url), body: shown };

    if (ep.verified !== true) {
      return {
        ok: false,
        sent: false,
        op,
        endpoint_unverified: true,
        error_class: 'blocked',
        error: `${A.label} "${op}" (${ep.method} ${pathOf(url)}) was not confirmed against ${A.label}'s own documentation when this adapter was written, so it is refused rather than sent. ${ep.note || ''}`.trim(),
        would_request: would,
        doc: ep.doc || null,
      };
    }

    const isRead = ep.method === 'GET' || ep.read === true;
    if (isRead) {
      if (!liveConnectorsEnabled()) {
        return {
          ok: false, sent: false, op, live: false, error_class: 'blocked',
          error: 'LIVE_CONNECTORS is off on this deployment, which is the default, so nothing was read from the platform.',
          would_request: would, doc: ep.doc || null,
        };
      }
      const r = ep.method === 'GET'
        ? await this.read(url, { headers, timeoutMs })
        : await this.readPost(url, { headers, body, timeoutMs });
      return r.ok
        ? { ok: true, sent: true, op, data: r.data, raw: r.data, doc: ep.doc || null }
        : Object.assign({ sent: true, op, doc: ep.doc || null }, r);
    }

    const r = await this.send(url, { method: ep.method, headers, body, describeBody, timeoutMs, rawBody, captureHeaders });
    return Object.assign({ op, doc: ep.doc || null }, r, r.ok ? { data: r.raw } : {});
  }

  /**
   * Ask the write gate for `op` BEFORE any preparatory read or fetch, and
   * answer with the request the write would have made when it may not. Used
   * where a write needs a read first (TikTok's creator_info, YouTube's media
   * bytes): with a switch off, the operator sees the write that was withheld,
   * not the read that preceded it, and nothing at all leaves the deployment.
   * Returns null when the write may proceed.
   */
  writeRefusal(op, { params, query, body } = {}) {
    const A = this.constructor;
    const ep = A.endpointFor(op);
    if (!ep) return { ok: false, sent: false, error: `No endpoint "${op}" is declared for ${A.label}.`, error_class: 'permanent' };
    const built = fillUrl(ep.url, params, query);
    if (!built.ok) return { ok: false, sent: false, error: built.error, error_class: 'validation', op };
    const would = { method: ep.method, url: redactUrl(built.url), body: redact(body) };
    if (ep.verified !== true) {
      return { ok: false, sent: false, op, endpoint_unverified: true, error_class: 'blocked', error: `${A.label} "${op}" was not confirmed against ${A.label}'s own documentation, so it is refused rather than sent.`, would_request: would, doc: ep.doc || null };
    }
    const gate = publishAllowance(built.url, Object.assign({}, this.ctx, { writeSwitch: A.writeSwitch || null, platformLabel: A.label }));
    if (gate.allowed) return null;
    return { ok: false, sent: false, op, error: gate.blocker, error_class: gate.reason === 'dry_run' ? 'validation' : 'blocked', blocked_by: gate.reason, would_request: would, doc: ep.doc || null };
  }

  /**
   * A POST that the platform documents as a READ. Not subject to the publish
   * gate (it changes nothing), always subject to the standing read-only guard
   * (assertReadOnly throws on a POST to a guarded host), and only reachable
   * through callEndpoint, which checked LIVE_CONNECTORS and verification first.
   */
  async readPost(url, { headers = {}, body, timeoutMs = 20000 } = {}) {
    try { assertReadOnly(url, 'POST'); } catch (err) { return { ok: false, status: 0, error: err.message, error_class: 'blocked' }; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
        cache: 'no-store',
      });
      const text = await res.text();
      let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
      return res.ok
        ? { ok: true, data: json }
        : { ok: false, status: res.status, error: shorten(json), error_class: classifyStatus(res.status, json), retry_after_ms: retryAfterMs(res.headers) };
    } catch (err) {
      return { ok: false, status: 0, error: String((err && err.message) || err), error_class: 'transient' };
    } finally {
      clearTimeout(timer);
    }
  }

  /* — the social gateway contract (2026-10-04) —
     Every adapter answers these. The default is an honest "this platform does
     not offer it here", never an empty success that would read as "nothing to
     report". */

  /** @returns {Promise<{ok:boolean, supported?:boolean, metrics?:Array, note?:string}>} */
  async readPostMetrics(_refs) { return unsupported(this.constructor.label, 'organic post metrics'); }
  /** @returns {Promise<{ok:boolean, supported?:boolean, rows?:Array, note?:string}>} */
  async readAdMetrics(_range) { return unsupported(this.constructor.label, 'ad performance reads'); }
  /** @returns {Promise<{ok:boolean, supported?:boolean, comments?:Array, note?:string}>} */
  async listComments(_ref) { return unsupported(this.constructor.label, 'comment reads'); }
  /** @returns {Promise<{ok:boolean, supported?:boolean, mentions?:Array, note?:string}>} */
  async listMentions(_ref) { return unsupported(this.constructor.label, 'mention reads'); }
  /** @returns {Promise<DispatchResult>} */
  async replyToComment(_spec) { return Object.assign({ error_class: 'validation', sent: false }, unsupported(this.constructor.label, 'comment replies'), { error: `${this.constructor.label} does not offer comment replies through this platform.` }); }
  /** @returns {Promise<DispatchResult>} */
  async moderateComment(_spec) { return Object.assign({ error_class: 'validation', sent: false }, unsupported(this.constructor.label, 'comment moderation'), { error: `${this.constructor.label} does not offer comment moderation through this platform.` }); }
  /**
   * LIVE APPROVAL: turn a PAUSED/DRAFT/private object on. Only ever reached
   * through a `<platform>_live_approval` dispatch job, so it carries the
   * operator who approved it and passes all three switches.
   * @returns {Promise<DispatchResult>}
   */
  async activate(_spec) { return { ok: false, sent: false, error_class: 'validation', error: `${this.constructor.label} has no live-approval step wired in this platform.` }; }

  /**
   * A stable id for one webhook delivery, used to make ingestion idempotent.
   * Most platforms send no event id, and a retry re-sends the SAME bytes, so
   * the digest of the verified bytes is the id. An adapter whose platform does
   * carry one overrides this.
   */
  webhookEventId(_event, rawBytes) {
    const b = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(String(rawBytes == null ? '' : rawBytes), 'utf8');
    return 'sha256:' + require('crypto').createHash('sha256').update(b).digest('hex');
  }
  /** The platform account an event belongs to, used to find the workspace. */
  webhookAccountId(_event) { return null; }
  /** Normalised items in a delivery: [{kind, object_id, account_id, field, text?, status?}]. */
  webhookItems(_event) { return []; }

  /** Marker for a fact the asset did not carry. Never a placeholder value. */
  gap(field, extra) { return `[DATA REQUIRED BEFORE LAUNCH: ${field}${extra ? ', ' + extra : ''}]`; }
}

/** Path of a URL, for a sentence. */
function pathOf(url) { try { return new URL(url).pathname; } catch (_) { return String(url || ''); } }

/**
 * A social platform: organic publishing, comments and mentions, and (where the
 * platform has one) its own ad API. Same contract as the base; the class exists
 * so the hub can group platforms by what they are.
 */
class SocialPlatformAdapter extends BasePlatformAdapter {
  static get category() { return 'social'; }
}

/* ── the two specialisations ──────────────────────────────────────────────── */

/**
 * An advertising platform: campaign structure, plus the public ad libraries
 * that make competitive research possible.
 */
class AdPlatformAdapter extends BasePlatformAdapter {
  static get category() { return 'ads'; }

  /** @returns {Promise<{ok:boolean, accounts?:Array<{id:string,name:string}>, note?:string}>} */
  async listAdAccounts() { return { ok: false, note: 'not implemented' }; }

  /** @returns {Promise<DispatchResult>} */
  async createCampaign(_spec) { return { ok: false, error: 'not implemented', error_class: 'permanent' }; }
  /** @returns {Promise<DispatchResult>} */
  async createAdSet(_spec) { return { ok: false, error: 'not implemented', error_class: 'permanent' }; }
  /** @returns {Promise<DispatchResult>} */
  async createAd(_spec) { return { ok: false, error: 'not implemented', error_class: 'permanent' }; }

  /**
   * Public ad-library search. This is a READ of a public archive, so it is not
   * subject to the publish gate and does not need a workspace's ad account.
   * @returns {Promise<{ok:boolean, ads?:Array<Object>, source?:string, note?:string}>}
   */
  async searchAdLibrary(_query) { return { ok: false, note: 'not implemented' }; }
}

/** A lifecycle / CRM platform: audiences, templates, campaigns and flows. */
class CrmPlatformAdapter extends BasePlatformAdapter {
  static get category() { return 'crm'; }

  async listAudiences() { return { ok: false, note: 'not implemented' }; }
  async listSegments() { return { ok: false, note: 'not implemented' }; }
  /** @returns {Promise<DispatchResult>} */
  async createTemplate(_spec) { return { ok: false, error: 'not implemented', error_class: 'permanent' }; }
  /** @returns {Promise<DispatchResult>} */
  async createCampaign(_spec) { return { ok: false, error: 'not implemented', error_class: 'permanent' }; }
  /** @returns {Promise<DispatchResult>} */
  async scheduleCampaign(_id, _whenIso) { return { ok: false, error: 'not implemented', error_class: 'permanent' }; }
  /** @returns {Promise<DispatchResult>} */
  async triggerFlow(_spec) { return { ok: false, error: 'not implemented', error_class: 'permanent' }; }

  /**
   * The sunset policy's hands. Suppressing an unengaged contact is the single
   * most effective thing a sender can do for its own reputation, and it is a
   * WRITE, so it goes through the same gate as a campaign.
   * @returns {Promise<DispatchResult>}
   */
  async suppressProfiles(_profileIds, _reason) { return { ok: false, error: 'not implemented', error_class: 'permanent' }; }
}

/* ── redaction ────────────────────────────────────────────────────────────── */

const SECRET_KEYS = /^(access_token|refresh_token|api_key|client_secret|secret|password|authorization|token|developer_token|private_key)$/i;

/**
 * Strip anything credential-shaped before a body is stored or returned. The
 * would_request envelope is shown in the UI and written to dispatch_attempts,
 * so an unredacted body would put a live token in a table members can read.
 */
function redact(value, depth) {
  const d = depth || 0;
  if (d > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, d + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(value[k], d + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 400) return value.slice(0, 400) + `…(+${value.length - 400})`;
  return value;
}

function shorten(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v || '');
  return s.length > 500 ? s.slice(0, 500) + '…' : s;
}

module.exports = {
  BasePlatformAdapter,
  AdPlatformAdapter,
  CrmPlatformAdapter,
  SocialPlatformAdapter,
  classifyStatus,
  retryAfterMs,
  publishAllowance,
  redact,
  redactUrl,
  fillUrl,
};
