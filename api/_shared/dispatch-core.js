'use strict';
/**
 * dispatch-core.js — the queue that actually sends things.
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT BULLMQ. The brief named BullMQ, Temporal or Celery. All three
 * are worker processes that outlive a request; this deployment is Vercel
 * serverless on a plan with no always-on compute and a hard cap of twelve
 * functions. There is nowhere to run a worker, and pretending otherwise would
 * produce a queue that drains only while somebody happens to be holding a page
 * open.
 *
 * What this repo already does instead, twice (smart-brain-plan.prebuildAssets
 * and brand-context-pack), is a CONVERGENT QUEUE: the state lives on the row,
 * one invocation drains a small batch, and it re-fires itself until nothing is
 * runnable. The properties that matter are kept:
 *
 *   at-least-once      a job is only marked done after the platform accepted it
 *   idempotency        a unique index on (workspace_id, idempotency_key), so a
 *                      retry after a timeout cannot double-post
 *   backoff            exponential with jitter, and a platform's own
 *                      Retry-After always wins over our arithmetic
 *   rate awareness     a 429 cools down the whole provider for that workspace,
 *                      not just the job that hit it
 *   leases             a conditional claim, so two concurrent invocations
 *                      cannot both send the same job
 *   visibility         every attempt is a row, with its error class and backoff
 *
 * THE ONE THING A ROW-BASED QUEUE CANNOT DO is guarantee exactly-once. Neither
 * can BullMQ. A send that times out may still have landed, so the idempotency
 * key is not an optimisation here, it is the correctness argument: every
 * adapter either takes a platform-side idempotency key or resumes from a
 * partial artefact (see MetaAdapter.publishInstagram's container id).
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * Routed from api/brain.js ?action=dispatch-*.
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');
const brandCore = require('./brand-workspace-core.js');
const connections = require('./workspace-connections-core.js');
const oauth = require('./oauth-core.js');
const { adapterFor, adapterForChannel, connectionProviderFor } = require('./adapters/registry.js');
const { redact } = require('./adapters/base-adapter.js');

const BATCH = 5;                        // jobs per invocation
const LEASE_MS = 2 * 60 * 1000;         // a lease longer than any single send
const BASE_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const SELF_FIRE_MS = 3000;              // handoff window, same as prebuildAssets

/* ── storage (service role: the queue runs under the scheduler) ───────────── */

function serviceEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    const e = new Error('SUPABASE_SERVICE_ROLE_KEY is required to run the dispatch queue.');
    e.status = 503; e.code = 'dispatch_store_unavailable';
    throw e;
  }
  return { url: String(url).replace(/\/$/, ''), key };
}

async function rest(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const e = serviceEnv();
  const headers = { apikey: e.key, authorization: `Bearer ${e.key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) { const err = new Error(`dispatch store ${method} -> ${res.status}: ${String(text).slice(0, 200)}`); err.status = 502; throw err; }
  return json;
}

/* ── idempotency ──────────────────────────────────────────────────────────── */

/**
 * A key that identifies the INTENT, not the attempt. Two presses of "publish"
 * on the same asset, to the same channel, for the same slot, are one send.
 *
 * The payload digest is part of it on purpose: if the operator edits the copy
 * and publishes again, that IS a different intent and should produce a second
 * job rather than silently deduplicating into the first.
 */
function deriveIdempotencyKey(spec) {
  const s = spec || {};
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify({
      provider: s.provider, channel: s.channel, asset_ref: s.asset_ref || '',
      scheduled_for: s.scheduled_for || '', payload: stable(s.payload || {}),
    }))
    .digest('hex').slice(0, 32);
  return `${s.provider}:${s.channel}:${digest}`;
}

/** Key order must not change the hash, or an idempotency key stops being one. */
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = stable(v[k]);
    return out;
  }
  return v;
}

/* ── backoff ──────────────────────────────────────────────────────────────── */

/**
 * Exponential with full jitter. The jitter is not decoration: without it every
 * job that failed in the same batch retries at the same instant and recreates
 * the burst that caused the failure.
 */
function backoffMs(attempt, retryAfterMs) {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, MAX_BACKOFF_MS);
  const ceiling = Math.min(BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempt - 1)), MAX_BACKOFF_MS);
  return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
}

/* ── enqueue ──────────────────────────────────────────────────────────────── */

/**
 * Create a job. Runs the preflight gate FIRST, so a send that would damage the
 * sending domain never becomes a queued job that a later retry might release.
 *
 * @returns {Promise<{ok:boolean, job?:Object, preflight?:Object, deduped?:boolean}>}
 */
async function enqueue(auth, workspaceId, spec) {
  const s = spec || {};
  await brandCore.assertCanWrite(auth, workspaceId, 'publish to a connected platform');

  const channelId = String(s.channel || '');
  const Adapter = adapterForChannel(channelId);
  if (!Adapter) { const e = new Error(`Unknown channel "${channelId}".`); e.status = 400; throw e; }
  const provider = Adapter.id;

  const mode = ['publish', 'schedule', 'draft'].indexOf(String(s.mode)) >= 0 ? String(s.mode) : 'publish';
  if (mode === 'schedule' && !s.scheduled_for) {
    const e = new Error('A scheduled dispatch needs scheduled_for.'); e.status = 400; throw e;
  }

  // Map the asset through the adapter now rather than at send time, so the
  // operator sees the resolved payload and its gaps before anything is queued.
  const conn = await connections.getConnectionAsService(workspaceId, connectionProviderFor(provider));
  const adapter = new Adapter({ workspaceId, credentials: {}, connection: conn });
  const mapped = s.payload && s.skip_mapping
    ? { ok: true, payload: s.payload, warnings: [], missing: [] }
    : adapter.map(s.asset || s.payload || {}, s.mapping || {});

  const preflight = await require('./preflight-core.js').run({
    workspaceId, provider, channel: channelId, mode,
    payload: mapped.payload, mapping_missing: mapped.missing, connection: conn,
    segment: s.segment || null, audience_size: s.audience_size,
  });

  if (preflight.verdict === 'block' && !s.override_preflight) {
    return { ok: false, blocked: true, preflight, mapped, message: preflight.blocking.join(' ') };
  }

  const idempotencyKey = String(s.idempotency_key || deriveIdempotencyKey({
    provider, channel: channelId, asset_ref: s.asset_ref, scheduled_for: s.scheduled_for, payload: mapped.payload,
  }));

  const row = {
    workspace_id: workspaceId,
    idempotency_key: idempotencyKey,
    provider,
    channel: channelId,
    mapping_id: s.mapping_id || null,
    asset_kind: s.asset_kind || null,
    asset_ref: s.asset_ref || null,
    payload: mapped.payload,
    redacted_payload: redact(mapped.payload),
    mode,
    scheduled_for: s.scheduled_for || null,
    // A draft never becomes runnable; it is a record of an intent the operator
    // exported to the platform's own UI instead.
    status: mode === 'draft' ? 'draft' : 'queued',
    preflight_verdict: preflight.verdict,
    next_attempt_at: s.scheduled_for && mode === 'schedule' ? new Date(s.scheduled_for).toISOString() : new Date().toISOString(),
    dry_run: !!s.dry_run,
    created_by: auth.user_id || null,
    max_attempts: Math.min(Math.max(Number(s.max_attempts) || 5, 1), 10),
  };

  let job;
  try {
    const saved = await rest('dispatch_jobs?select=*', { method: 'POST', body: [row], prefer: 'return=representation' });
    job = Array.isArray(saved) ? saved[0] : saved;
  } catch (err) {
    // The unique index did its job: this exact intent is already queued or sent.
    if (/duplicate key|23505/i.test(String(err.message || ''))) {
      const existing = await rest(`dispatch_jobs?select=*&workspace_id=eq.${encodeURIComponent(workspaceId)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`);
      return { ok: true, deduped: true, job: Array.isArray(existing) ? existing[0] : null, preflight, mapped };
    }
    throw err;
  }

  await rest('preflight_audits', {
    method: 'POST',
    body: [{
      workspace_id: workspaceId, job_id: job.id, provider, channel: channelId,
      verdict: preflight.verdict, score: preflight.score, checks: preflight.checks,
      blocking: preflight.blocking,
      overridden_by: preflight.verdict === 'block' && s.override_preflight ? (auth.user_id || null) : null,
      override_note: preflight.verdict === 'block' && s.override_preflight ? String(s.override_note || 'Operator override.').slice(0, 500) : null,
    }],
    prefer: 'return=minimal',
  });

  return { ok: true, job, preflight, mapped };
}

/* ── claim ────────────────────────────────────────────────────────────────── */

/**
 * Take a lease on one job. The PATCH carries the guard in its WHERE clause, so
 * two invocations racing for the same row produce one winner and one empty
 * result - a read-then-write would let both through.
 */
async function claim(jobId, owner) {
  const now = new Date().toISOString();
  const rows = await rest(
    `dispatch_jobs?id=eq.${encodeURIComponent(jobId)}`
    + `&status=in.(queued,ready,sending)`
    + `&or=(lease_owner.is.null,lease_expires_at.lt.${encodeURIComponent(now)})`
    + `&select=*`,
    {
      method: 'PATCH',
      body: { lease_owner: owner, lease_expires_at: new Date(Date.now() + LEASE_MS).toISOString(), status: 'sending', updated_at: now },
      prefer: 'return=representation',
    },
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function runnableJobs(workspaceId, limit) {
  const now = new Date().toISOString();
  const ws = workspaceId ? `&workspace_id=eq.${encodeURIComponent(workspaceId)}` : '';
  return rest(
    `dispatch_jobs?select=*&status=in.(queued,ready)&next_attempt_at=lte.${encodeURIComponent(now)}${ws}`
    + `&order=next_attempt_at.asc&limit=${Math.min(Number(limit) || BATCH, 25)}`,
  );
}

/* ── run one job ──────────────────────────────────────────────────────────── */

async function runJob(job) {
  const started = Date.now();
  const attemptNo = Number(job.attempt_count || 0) + 1;
  const provider = job.provider;
  const Adapter = adapterFor(provider);

  const finish = async (patch, attempt) => {
    await rest(`dispatch_jobs?id=eq.${encodeURIComponent(job.id)}`, {
      method: 'PATCH',
      body: Object.assign({ updated_at: new Date().toISOString(), lease_owner: null, lease_expires_at: null }, patch),
      prefer: 'return=minimal',
    });
    await rest('dispatch_attempts', {
      method: 'POST',
      body: [Object.assign({
        job_id: job.id, workspace_id: job.workspace_id, attempt_no: attemptNo,
        started_at: new Date(started).toISOString(), finished_at: new Date().toISOString(),
      }, attempt)],
      prefer: 'return=minimal',
    }).catch(() => { /* the attempt log must never fail the job */ });
  };

  if (!Adapter) {
    await finish({ status: 'failed', last_error: `No adapter for "${provider}".`, completed_at: new Date().toISOString() },
      { ok: false, error_class: 'permanent', error_message: `No adapter for "${provider}".` });
    return { id: job.id, ok: false, terminal: true };
  }

  // Fresh credentials. On the hot path because a Klaviyo access token is valid
  // for ten minutes.
  const fresh = await oauth.ensureFreshToken(job.workspace_id, provider);
  if (!fresh.ok) {
    const terminal = !!fresh.reconnect_required;
    const wait = backoffMs(attemptNo);
    await finish(
      terminal
        ? { status: 'failed', last_error: fresh.note, completed_at: new Date().toISOString(), attempt_count: attemptNo }
        : { status: 'queued', attempt_count: attemptNo, next_attempt_at: new Date(Date.now() + wait).toISOString(), last_error: fresh.note },
      { ok: false, error_class: 'auth', error_message: String(fresh.note || '').slice(0, 500), backoff_ms: terminal ? null : wait },
    );
    return { id: job.id, ok: false, terminal };
  }

  const conn = await connections.getConnectionAsService(job.workspace_id, connectionProviderFor(provider));
  const publishEnabled = !!(conn && conn.config && (conn.config.publishing_enabled === true || conn.config.publishing_enabled === 'true'));

  const adapter = new Adapter({
    workspaceId: job.workspace_id,
    credentials: fresh.credentials,
    connection: conn,
    dryRun: !!job.dry_run,
    publishEnabled,
    idempotencyKey: job.idempotency_key,
  });

  // Resume state from a previous partial attempt (an Instagram container that
  // was created but not published) so a retry completes rather than duplicates.
  const payload = Object.assign({}, job.payload, (job.result && job.result.resume) || {});

  let result;
  try {
    result = await adapter.dispatch(job.channel, payload);
  } catch (err) {
    result = { ok: false, sent: false, error: String((err && err.message) || err), error_class: 'transient' };
  }

  const digest = result.would_request ? `${result.would_request.method} ${hostOf(result.would_request.url)}` : `${provider}:${job.channel}`;

  if (result.ok) {
    await finish({
      status: 'succeeded',
      external_id: result.external_id || null,
      external_status: result.status || null,
      result: sanitizeResult(result),
      attempt_count: attemptNo,
      completed_at: new Date().toISOString(),
      last_error: null,
    }, { ok: true, http_status: 200, request_digest: digest, response_head: sanitizeResult(result) });

    await logSync(job, true, result);
    return { id: job.id, ok: true };
  }

  // A refusal by the publish gate is not a failure to retry: nothing will change
  // on its own, and retrying five times just fills the log.
  const cls = result.error_class || 'transient';
  const terminal = cls === 'permanent' || cls === 'validation' || cls === 'blocked' || attemptNo >= Number(job.max_attempts || 5);
  const wait = terminal ? 0 : backoffMs(attemptNo, result.retry_after_ms);

  await finish(
    terminal
      ? {
        status: cls === 'blocked' ? 'blocked' : 'failed',
        attempt_count: attemptNo,
        last_error: String(result.error || '').slice(0, 1000),
        result: sanitizeResult(result),
        completed_at: new Date().toISOString(),
      }
      : {
        status: 'queued',
        attempt_count: attemptNo,
        next_attempt_at: new Date(Date.now() + wait).toISOString(),
        retry_after_at: result.retry_after_ms ? new Date(Date.now() + result.retry_after_ms).toISOString() : null,
        last_error: String(result.error || '').slice(0, 1000),
        result: sanitizeResult(result),
      },
    { ok: false, error_class: cls, error_message: String(result.error || '').slice(0, 500), backoff_ms: wait || null, request_digest: digest },
  );

  await logSync(job, false, result);
  return { id: job.id, ok: false, terminal, error_class: cls };
}

/** Only fields safe to store: never a token, never a full response body. */
function sanitizeResult(result) {
  return {
    ok: !!result.ok,
    sent: result.sent !== false,
    status: result.status || null,
    external_id: result.external_id || null,
    error_class: result.error_class || null,
    endpoint_unverified: !!result.endpoint_unverified,
    note: result.note ? String(result.note).slice(0, 600) : undefined,
    would_request: result.would_request ? { method: result.would_request.method, url: result.would_request.url, body: redact(result.would_request.body) } : undefined,
    resume: result.resume || undefined,
  };
}

function hostOf(url) { try { return new URL(url).host; } catch (_) { return 'unknown'; } }

async function logSync(job, ok, result) {
  await rest('platform_sync_log', {
    method: 'POST',
    body: [{
      workspace_id: job.workspace_id, provider: job.provider, direction: 'outbound',
      operation: `dispatch:${job.channel}`, job_id: job.id, ok,
      records: ok ? 1 : 0,
      note: String((ok ? result.status : result.error) || '').slice(0, 500),
      detail: sanitizeResult(result),
    }],
    prefer: 'return=minimal',
  }).catch(() => { /* logging must never fail a send */ });
}

/* ── the convergent drain ─────────────────────────────────────────────────── */

/**
 * Drain one batch, then re-fire if anything is left. Same shape as
 * smart-brain-plan.prebuildAssets: the child keeps running after the parent's
 * client aborts, so a long queue converges without a worker process.
 *
 * @returns {Promise<{ok:boolean, ran:number, remaining:number, results:Array}>}
 */
async function drain({ workspaceId = null, limit = BATCH, selfFire = true } = {}) {
  const owner = `${process.env.VERCEL_REGION || 'local'}:${crypto.randomBytes(6).toString('hex')}`;
  const candidates = await runnableJobs(workspaceId, limit);
  const results = [];

  // Serial, not parallel. These are sends to a real person's inbox or a real
  // ad account; a burst is exactly what trips a platform rate limit, and the
  // cooldown that follows is measured in minutes.
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const job = await claim(c.id, owner);
    if (!job) continue;                       // another invocation got it
    results.push(await runJob(job));
    if (results[results.length - 1].error_class === 'rate_limited') break;   // stop pushing at a wall
  }

  const remaining = await countRunnable(workspaceId);
  if (selfFire && remaining > 0 && results.length > 0) fireNext(workspaceId);
  return { ok: true, ran: results.length, remaining, results };
}

async function countRunnable(workspaceId) {
  const now = new Date().toISOString();
  const ws = workspaceId ? `&workspace_id=eq.${encodeURIComponent(workspaceId)}` : '';
  const e = serviceEnv();
  const res = await fetch(
    `${e.url}/rest/v1/dispatch_jobs?select=id&status=in.(queued,ready)&next_attempt_at=lte.${encodeURIComponent(now)}${ws}`,
    { headers: { apikey: e.key, authorization: `Bearer ${e.key}`, Prefer: 'count=exact', Range: '0-0' }, cache: 'no-store' },
  ).catch(() => null);
  if (!res) return 0;
  const range = res.headers.get('content-range') || '';
  const total = Number(String(range).split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

/** Fire and forget, with the 3s handoff the prebuild queue established. */
function fireNext(workspaceId) {
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : String(process.env.PUBLIC_BASE_URL || '');
  const secret = String(process.env.CRON_SECRET || '');
  if (!base || !secret) return;
  const url = `${base}/api/brain?action=dispatch-drain${workspaceId ? `&workspace_id=${encodeURIComponent(workspaceId)}` : ''}`;
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), SELF_FIRE_MS);
  fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, signal: ctrl.signal }).catch(() => { /* expected: we abort it */ });
}

/* ── cancel ───────────────────────────────────────────────────────────────── */

async function cancel(auth, workspaceId, jobId) {
  await brandCore.assertCanWrite(auth, workspaceId, 'cancel a dispatch');
  const rows = await rest(
    `dispatch_jobs?id=eq.${encodeURIComponent(jobId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&status=in.(queued,ready,draft,blocked)&select=id,status`,
    { method: 'PATCH', body: { status: 'cancelled', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }, prefer: 'return=representation' },
  );
  if (!Array.isArray(rows) || !rows.length) {
    // Deliberately not an error the caller can retry into a lie: a job that is
    // already sending or sent cannot be un-sent.
    return { ok: false, error: 'not_cancellable', message: 'That job is already sending or has completed. A send that has left this platform cannot be recalled from here.' };
  }
  return { ok: true, cancelled: jobId };
}

/* ── webhooks ─────────────────────────────────────────────────────────────── */

/**
 * Ingest a platform callback. Stored BEFORE it is trusted, and acted on only if
 * the signature verified - an unverified event is diagnosis material, never a
 * status change.
 */
async function ingestWebhook(provider, headers, rawBody) {
  const Adapter = adapterFor(provider);
  if (!Adapter) return { ok: false, error: `Unknown platform "${provider}".` };

  const adapter = new Adapter({ workspaceId: '', credentials: {} });
  const check = adapter.verifyWebhook(headers, rawBody);

  let parsed = null;
  try { parsed = JSON.parse(rawBody || 'null'); } catch (_) { /* keep null */ }

  const externalId = parsed && (parsed.id || (parsed.entry && parsed.entry[0] && parsed.entry[0].id)) || null;
  await rest('platform_webhook_events', {
    method: 'POST',
    body: [{
      provider, event_type: (parsed && (parsed.object || parsed.type)) || null,
      external_id: externalId ? String(externalId) : null,
      verified: !!check.verified,
      signature_note: String(check.note || '').slice(0, 300),
      payload: check.verified ? parsed : { unverified: true, bytes: String(rawBody || '').length },
    }],
    prefer: 'return=minimal,resolution=merge-duplicates',
  }).catch(() => { /* a duplicate delivery is not an error */ });

  if (!check.verified) {
    return { ok: false, verified: false, note: check.note, stored: true };
  }

  // Reconcile against a job when the event names something we sent.
  let updated = 0;
  if (externalId) {
    const jobs = await rest(`dispatch_jobs?select=id,workspace_id&external_id=eq.${encodeURIComponent(String(externalId))}&limit=5`);
    for (const j of Array.isArray(jobs) ? jobs : []) {
      await rest(`dispatch_jobs?id=eq.${encodeURIComponent(j.id)}`, {
        method: 'PATCH',
        body: { external_status: String((parsed && (parsed.status || parsed.event_type)) || 'updated').slice(0, 80), updated_at: new Date().toISOString() },
        prefer: 'return=minimal',
      });
      updated += 1;
    }
  }
  return { ok: true, verified: true, jobs_updated: updated };
}

/* ── reads ────────────────────────────────────────────────────────────────── */

async function listJobs(auth, workspaceId, { status, limit = 50 } = {}) {
  const filter = status ? `&status=eq.${encodeURIComponent(status)}` : '';
  const rows = await brandCore.restAs(
    auth.token,
    `dispatch_jobs?select=id,provider,channel,mode,status,scheduled_for,preflight_verdict,attempt_count,max_attempts,next_attempt_at,external_id,external_status,last_error,redacted_payload,dry_run,created_at,completed_at`
    + `&workspace_id=eq.${encodeURIComponent(workspaceId)}${filter}&order=created_at.desc&limit=${Math.min(Number(limit) || 50, 200)}`,
  );
  return Array.isArray(rows) ? rows : [];
}

async function jobDetail(auth, workspaceId, jobId) {
  const [job] = await brandCore.restAs(auth.token, `dispatch_jobs?select=*&id=eq.${encodeURIComponent(jobId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`);
  if (!job) return null;
  const attempts = await brandCore.restAs(auth.token, `dispatch_attempts?select=*&job_id=eq.${encodeURIComponent(jobId)}&order=attempt_no.asc`);
  const preflight = await brandCore.restAs(auth.token, `preflight_audits?select=*&job_id=eq.${encodeURIComponent(jobId)}&order=created_at.desc&limit=1`);
  // The raw payload can hold a customer's address; the redacted one is what a
  // member sees. The full one is only ever used by the adapter.
  delete job.payload;
  return { job, attempts: attempts || [], preflight: (preflight || [])[0] || null };
}

module.exports = {
  enqueue, drain, runJob, cancel, ingestWebhook, listJobs, jobDetail,
  deriveIdempotencyKey, backoffMs, claim, countRunnable,
  BATCH, BASE_BACKOFF_MS, MAX_BACKOFF_MS, LEASE_MS,
};
