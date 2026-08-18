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
 *   3. For klaviyo / shopify / webengage only: the deployment's per-platform
 *      escape hatch (<PLATFORM>_ALLOW_WRITES=1) must be set, because those three
 *      are covered by the standing read-only rule and an adapter is not
 *      entitled to decide that rule does not apply to it.
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

  return { allowed: true, reason: 'allowed', blocker: '' };
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
    return { verified: false, note: 'No signature scheme is wired for this platform.' };
  }

  /* — helpers every adapter shares — */

  /**
   * The single outbound call. Enforces the publish gate, records what it would
   * have sent when it is not allowed to send, classifies failures, and never
   * lets a credential into the returned envelope.
   * @returns {Promise<DispatchResult>}
   */
  async send(url, { method = 'POST', headers = {}, body, timeoutMs = 20000, describeBody } = {}) {
    const shown = describeBody !== undefined ? describeBody : redact(body);
    const gate = publishAllowance(url, this.ctx);
    if (!gate.allowed) {
      return {
        ok: false,
        sent: false,
        error: gate.blocker,
        error_class: gate.reason === 'dry_run' ? 'validation' : 'blocked',
        would_request: { method, url, body: shown },
      };
    }

    // Defense in depth: the gate above already checked, but the standing guard
    // is what actually throws, and it should stay the last word.
    try { assertReadOnly(url, method); } catch (err) {
      return { ok: false, sent: false, error: err.message, error_class: 'blocked', would_request: { method, url, body: shown } };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
        signal: ctrl.signal,
        cache: 'no-store',
      });
      const text = await res.text();
      let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
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
      return { ok: true, sent: true, status: 'accepted', raw: json };
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

  /** Marker for a fact the asset did not carry. Never a placeholder value. */
  gap(field, extra) { return `[DATA REQUIRED BEFORE LAUNCH: ${field}${extra ? ', ' + extra : ''}]`; }
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
  classifyStatus,
  retryAfterMs,
  publishAllowance,
  redact,
};
