'use strict';

/**
 * /api/calendar — single-function router for calendar generation,
 * mailer triggering, and Smart Brain actions.
 *
 * Consolidated to keep us under Vercel Hobby's 12-function limit. The
 * actual handlers still live in api/_shared/ (underscore prefix excludes
 * them from Vercel's function scan), so all the existing logic is intact
 * — this file only dispatches.
 *
 * Routes:
 *   ?action=generate         → POST: build a 30-day calendar
 *   ?action=trigger-mailer   → POST: feed one calendar row into the
 *                              /api/ai/pipeline stages to produce HTML
 *   ?action=smart-brain-*   → GET/POST: Smart Brain health/schema/daily run/
 *                              generation/feedback/recalibration, multiplexed
 *                              here to avoid adding a 13th Vercel function
 *   ?action=smart-brain-plan        → GET: current persisted rolling plan
 *   ?action=smart-brain-sync-daily  → POST: daily review — refresh tentative
 *                              entries from latest data, keep approved locked
 *   ?action=smart-brain-cron        → GET: Vercel Cron entrypoint for the same
 *                              (CRON_SECRET-protected); also kicks the prebuild chain
 *   ?action=smart-brain-prebuild    → POST: convergent background worker that
 *                              builds the FULL asset bundle (LLM copy + images:
 *                              mailer + ads + landing page) for every unbuilt slot
 *                              in the 90-day window, one batch per call, re-firing
 *                              itself until the whole window is prebuilt then idling
 *                              (CRON_SECRET-protected)
 *   ?action=smart-brain-preview     → POST: generate-on-demand funnel preview
 *                              (mailer + ads + LP) for any slot — NOT persisted,
 *                              status unchanged. Powers "View" before approval.
 *   ?action=smart-brain-approve     → POST: human sign-off → LLM-written
 *                              mailer + ads + landing page, persisted
 *   ?action=smart-brain-reject      → POST: reject slot, re-planned next sync
 *   ?action=lp&id=...               → GET: serve a generated landing page
 *   ?action=lifecycle-generate      → POST: deterministic cohort-native UK
 *                              lifecycle calendar (lifecycle-calendar-generate.js)
 *   ?action=lifecycle-list          → GET: read persisted lifecycle_calendar_entries
 *                              (graceful when Supabase is not configured)
 *   ?action=lifecycle-build-mailer  → POST { id | entry }: one LLM call →
 *                              brand-gated mailer HTML (lifecycle-mailer-build.js)
 */

const generate = require('./_shared/calendar-generate.js');
const lifecycleGen = require('./_shared/lifecycle-calendar-generate.js');
const lifecycleBuild = require('./_shared/lifecycle-mailer-build.js');
const triggerMailer = require('./_shared/calendar-trigger.js');
const plan = require('./_shared/smart-brain-plan.js');
const calExport = require('./_shared/calendar-export.js');
const { runDailySmartBrain, smartConfig, schemaAssumptions, GenerationService, SmartBrainDbAdapter } = require('../lib/smart-brain/services.js');

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  return req.body;
}

// A flag on a request is a BOOLEAN, and a query string carries STRINGS.
// `!!(body.force || q.force)` read `?force=false` and `?force=0` as true, so a
// request whose author had said NOT to regenerate skipped the retrieve-first
// path in buildLifecycleMailer: two LLM calls, and the persisted mailer
// overwritten. Only 1 / true / yes (any case) enable; everything else is off.
function flag(v) {
  if (v === true) return true;
  if (v === false || v === undefined || v === null) return false;
  return /^(?:1|true|yes)$/i.test(String(v).trim());
}

// Base URL for self-triggering the background prebuild chain. On Vercel this is
// VERCEL_URL (the current deployment); SELF_BASE_URL is an optional override.
function selfBaseUrl() {
  if (process.env.SELF_BASE_URL) return String(process.env.SELF_BASE_URL).replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return '';
}

// Fire the NEXT prebuild batch as an independent invocation and return once it
// has started (or after a short cutoff). We do NOT await the whole batch — the
// child invocation keeps running on Vercel after our client connection drops, so
// this hands off without blocking the current response for 30-60s. Guarded by
// CRON_SECRET; a no-op when we cannot resolve a base URL (e.g. local dev).
async function firePrebuild(depth = 0) {
  const base = selfBaseUrl();
  if (!base || typeof fetch !== 'function') return { fired: false, reason: 'no self base url / no fetch' };
  const secret = process.env.CRON_SECRET || '';
  const url = `${base}/api/calendar?action=smart-brain-prebuild`;
  const headers = { 'Content-Type': 'application/json' };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    await fetch(url, { method: 'POST', headers, body: JSON.stringify({ _depth: (depth || 0) + 1 }), signal: ctrl.signal });
  } catch (_) { /* expected: the child runs longer than our 3s handoff window */ }
  finally { clearTimeout(timer); }
  return { fired: true };
}

async function smartBrain(req, res, smartAction) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const body = readBody(req);
  // Set below: a PERSON (verified session) whose request resolved no
  // workspace - a mobile+PIN account, whose brands live on its device.
  let personWithoutWorkspace = false;
  let verified = null;

  // Workspace scoping for EVERY smart-brain action. The adapter used to fall
  // back to the oldest workspace whenever no workspace_id arrived, so a signed
  // in user whose client had not (or could not - stale cache) stamped the
  // request was served TENANT ZERO's plan and campaigns. Resolve once here -
  // explicit param, else the caller's JWT -> their active workspace, else the
  // default only for userless (cron) calls - and thread it through config so
  // every adapter, read and generation below is scoped to it.
  try {
    const wsScope = require('./_shared/workspace-scope.js');
    const scopeEnv = {
      url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
      key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
    };
    let wsId = await wsScope.resolve(scopeEnv, req);

    // A BROWSER request that carries neither a workspace param nor a user token
    // cannot be attributed to anyone. Serving it the default workspace is how
    // another brand's plan reached a signed-in user's screen, so refuse instead
    // of guessing. Server-to-server calls (cron, the prebuild self-chain) have
    // no Origin/Referer header and keep the default-workspace behaviour.
    const q0 = (req && req.query) || {};
    const b0 = (req && req.body && typeof req.body === 'object') ? req.body : {};
    // A phone account names no workspace (workspace-scope.resolve ignores it;
    // it is removed here too so nothing below reads it back).
    if (wsScope.carriesMobileToken(req)) { delete q0.workspace_id; delete b0.workspace_id; delete body.workspace_id; }
    const hadExplicit = !!(q0.workspace_id || b0.workspace_id);
    // A token attributes the request only if the auth backend did not REFUSE
    // it (2026-09-29, review) - the same rule as api/brain.js. Counting the
    // header's presence let a forged bearer or a device-mode token past the
    // envelope below, into sync-daily's writes and approve's generation.
    const tokenOn = !!(req.headers && (req.headers.authorization || req.headers.Authorization || req.headers['x-lifecycle-token']));
    const scheduler = require('./_shared/require-caller.js').isCron(req);
    if (tokenOn && !scheduler) verified = await require('./_shared/brand-workspace-core.js').requireUser(req);
    const tokenRefused = !!(verified && !verified.ok && Number(verified.status) === 401);
    if (tokenRefused) {
      // A credential the backend rejected is answered with the rejection, not
      // admitted as though nothing had been presented (same rule as brain.js).
      return res.status(401).json({
        ok: false, error: verified.error || 'sign_in_required',
        message: verified.message || 'You are not signed in, so this could not run.',
      });
    }
    const hadAuth = tokenOn;
    personWithoutWorkspace = !!(verified && verified.ok && !wsId);
    body.config = Object.assign({}, body.config, { workspace_id: wsId || null });
    const fromBrowser = !!(req.headers && (req.headers.origin || req.headers.referer));
    if (!hadExplicit && !hadAuth && fromBrowser) {
      // `plan` and `insights` are present so this answer has the SAME shape as a
      // real sync response. Without them a client that reads `plan` saw
      // undefined, kept whatever was already on screen and reported nothing,
      // which is how a refused request came to look like a successful one.
      return res.status(200).json({
        ok: true, mode: 'unscoped', stored: false, entries: [], plan: [],
        changes: [], insights: [],
        error: 'workspace_unresolved',
        note: 'This request arrived without an active workspace, so no data is returned. '
          + 'Another brand\'s workspace is never substituted. Reload the page (hard refresh) so the brand context loads, then try again.',
      });
    }
  } catch (_) { body.config = body.config || {}; }

  // The brand RECORD this request is for, resolved once onto the request the
  // way api/brain.js does (2026-09-29, review). calendar.js never set it, so
  // smart-brain-plan's stampBrand() found no request brand and fell to the
  // OLDEST workspace's: a phone account's preview and approval were built
  // and written as tenant zero's campaign, over tenant zero's catalogue.
  // Only for a PERSON: a userless call (the scheduler, the prebuild chain)
  // keeps resolving its workspace's own row inside the planner, which is what
  // a WORKSPACE_ID-pinned run for another brand relies on.
  try {
    req.__workspaceId = (body.config && body.config.workspace_id) || null;
    if (verified && verified.ok) {
      const rt = require('./_shared/brand-runtime.js');
      const b = await rt.resolve(req, { workspace_id: req.__workspaceId, auth: verified });
      req.__brand = (b && (b.id || b.carried === true || b.unresolved === true)) ? b
        : rt.unresolvedBrand('a signed-in account with no brand workspace');
    }
  } catch (_) { req.__brand = null; }

  // GENERATION needs a verified caller or the scheduler, and a phone number
  // the operator has listed (2026-09-29, review). preview and approve build a
  // campaign from an `entry` the CALLER may supply - strategy and copy model
  // calls, and on approve six writes - and neither had any caller gate, so an
  // anonymous POST with no Origin, a forged token, or an unlisted phone
  // account spent the deployment's model keys on content of its choosing.
  const GENERATES = new Set(['preview', 'approve']);
  if (GENERATES.has(smartAction) && req.method === 'POST' && !require('./_shared/require-caller.js').isCron(req)) {
    const a = verified || await require('./_shared/brand-workspace-core.js').requireUser(req);
    if (!a || !a.ok) {
      return res.status(a && Number(a.status) === 503 ? 503 : 401).json({
        ok: false, error: (a && a.error) || 'sign_in_required',
        message: (a && a.message) || 'You are not signed in, so this could not run.',
        why: 'Building a campaign reaches an AI model on this deployment\'s keys, so it needs a signed-in account or the scheduler\'s secret. Nothing was built and nothing was saved.',
      });
    }
    const spend = require('./_shared/credits-core.js').spenderRefusal(a);
    if (spend) return res.status(spend.status || 403).json(spend);
  }

  // A PERSON WITH NO WORKSPACE (a mobile+PIN account) may read, plan and
  // preview; nothing it does may be WRITTEN, because there is no workspace to
  // write it into (2026-09-29, review). The adapter now refuses an unstamped
  // row, and these actions are refused before they spend a model call on a
  // result that cannot be kept.
  //
  // EXCEPT the reviewer's own decisions (2026-10-03). The operator's words:
  // "All features must work even with signin by number and pin". Approve,
  // reject, un-reject and feedback on a slot are the review flow itself, and
  // refusing them left a phone sign-in with a calendar it could look at and
  // never act on. None of them needs a workspace: approving builds the slot's
  // assets exactly as preview does, and the DECISION is the reviewer's record,
  // which this sign-in keeps on its device beside the brand (smart-brain.html).
  // So the build runs, nothing is written here, and the response says where
  // the decision lives. The plan-maintenance actions below still refuse: they
  // rewrite a stored plan, and a phone account's plan is computed per request.
  const DEVICE_DECISIONS = { approve: 'final', reject: 'rejected', unreject: 'tentative', feedback: null };
  if (personWithoutWorkspace && Object.prototype.hasOwnProperty.call(DEVICE_DECISIONS, smartAction) && req.method === 'POST') {
    const at = new Date().toISOString();
    const where = 'Kept on this device, beside the brand: this sign-in has no workspace in a database to record it in.';
    if (smartAction === 'feedback') {
      const feedback = { target_type: body.target_type || 'calendar_entry', target_id: body.target_id || null, verdict: body.verdict || 'comment', notes: String(body.notes || '').slice(0, 2000), reviewer: body.reviewer || null, created_at: at };
      return res.status(200).json({ ok: true, storage: 'device', feedback, note: where });
    }
    if (!body.id && !(body.entry && body.entry.id)) return res.status(400).json({ ok: false, error: 'id_required', message: 'Which calendar slot this decision is for was not sent, so nothing was recorded.' });
    const id = body.id || body.entry.id;
    if (smartAction === 'approve') {
      if (!body.entry) return res.status(400).json({ ok: false, error: 'entry_required', message: 'A phone sign-in\'s calendar is computed per request, so approving needs the slot itself sent with it. Nothing was built.' });
      // Built exactly as a preview is, and never persisted (body.persist is
      // already false for this caller): what the reviewer approves is what
      // they saw.
      let result;
      try { result = await plan.previewEntry({ id, entry: body.entry, reviewer: body.reviewer || null, config: body.config || {} }); }
      catch (err) {
        return res.status(Number(err && err.status) || 500).json({ ok: false, error: 'build_failed', message: String((err && err.message) || 'The slot\'s assets could not be built, so nothing was approved.') });
      }
      return res.status(200).json(Object.assign({}, result, {
        approved: true, persisted: false, storage: 'device',
        decision: { id, status: 'final', at, campaign_id: (result && result.campaign && result.campaign.campaign_id) || null },
        note: where,
      }));
    }
    return res.status(200).json({
      ok: true, storage: 'device',
      decision: { id, status: DEVICE_DECISIONS[smartAction], at, notes: smartAction === 'reject' ? String(body.notes || '').slice(0, 2000) : '' },
      note: where,
    });
  }
  const NEEDS_WORKSPACE = new Set(['heal', 'activate-scenario', 'recalibrate', 'weekly-recalibration']);
  if (personWithoutWorkspace && NEEDS_WORKSPACE.has(smartAction) && req.method === 'POST') {
    return res.status(409).json({
      ok: false, error: 'no_workspace',
      message: 'This rewrites the stored calendar, and this sign-in has none: a mobile-number account keeps its brands on the device and its calendar is computed each time, so there is no stored plan to change. Preview, approve and reject all work, and the decisions are kept on this device.',
    });
  }
  if (personWithoutWorkspace) {
    // Compute, never persist, and never kick the prebuild chain: there is
    // nothing of this caller's to prebuild, and the chain runs on the
    // scheduler's secret for the default workspace.
    body.persist = false;
    body.prebuild = false;
  }

  try {
    if (smartAction === 'health') {
      const config = smartConfig(body.config || {});
      const db = new SmartBrainDbAdapter(config);
      return res.status(200).json({ ok: true, service: 'knickgasm-smart-brain', db_linked: db.connected, modules: ['knowledge_base', 'analysis', 'competitor_benchmarking', 'calendar_intelligence', 'generation', 'human_review'], live_platform_push: false });
    }

    if (smartAction === 'schema') return res.status(200).json({ ok: true, ...schemaAssumptions(smartConfig(body.config || {})) });

    if (smartAction === 'plan') {
      const result = await plan.getPlan({ config: body.config || {} });
      return res.status(200).json(result);
    }

    if (smartAction === 'dbcheck') {
      // Safe diagnostic — no secret values, only project refs + HTTP statuses.
      return res.status(200).json(await plan.dbCheck({ config: body.config || {} }));
    }

    if (smartAction === 'sync-status') {
      // Shared-source-of-truth freshness (spec §24b): generated campaigns with
      // their stored freshness + a re-check of facts against the current library.
      return res.status(200).json(await plan.syncStatus({ config: body.config || {}, limit: body.limit || 60 }));
    }

    if (smartAction === 'export') {
      // Calendar → Google-Sheets-importable CSV. Uses the entries the client
      // already holds (what the reviewer sees) when POSTed; else pulls the plan.
      let entries = Array.isArray(body.entries) ? body.entries : null;
      if (!entries) { const p = await plan.getPlan({ config: body.config || {} }); entries = p.entries || []; }
      const csv = calExport.buildExportCsv(entries);
      const stamp = (entries[0] && entries[0].date) || 'plan';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="knickgasm-automated-calendar-${stamp}.csv"`);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).send(csv);
    }

    if (smartAction === 'sync-daily') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const result = await plan.syncDaily({ config: body.config || {}, days: body.days, persist: body.persist !== false });
      // Kick the background prebuild so newly added/refreshed slots get their full
      // asset bundle (copy + images) built ahead of need. Opt out with prebuild:false.
      if (body.prebuild !== false) { const f = await firePrebuild(0); result.prebuild_kicked = f.fired; }
      return res.status(200).json(result);
    }

    if (smartAction === 'prebuild') {
      // Convergent background worker: build a batch of unbuilt slots (full LLM
      // copy + images) then re-fire itself until the whole 90-day window is built.
      // CRON_SECRET-protected like cron; fails closed in production without one.
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const secret = process.env.CRON_SECRET || '';
      const auth = req.headers.authorization || '';
      const authorized = secret
        ? (auth === `Bearer ${secret}` || req.query?.secret === secret)
        : (String(process.env.VERCEL_ENV) !== 'production');
      if (!authorized) return res.status(401).json({ ok: false, error: 'Unauthorized prebuild call' });
      const depth = Math.max(0, +((body && body._depth) || req.query?.depth || 0));
      const MAX_DEPTH = 400; // backstop against runaway self-chaining (> 90d × markets slots)
      const batchSize = Math.max(1, Math.min(3, +((body && body.batchSize) || 1)));
      const result = await plan.prebuildAssets({ config: body.config || {}, batchSize });
      // Chain to the next batch only while making progress and within the backstop,
      // so a total-failure batch (e.g. LLM down) stops instead of hot-looping.
      let chained = false;
      if (result.remaining > 0 && result.built.length > 0 && depth < MAX_DEPTH) {
        const f = await firePrebuild(depth);
        chained = f.fired;
      }
      return res.status(200).json({ ok: true, prebuild: true, depth, chained, ...result });
    }

    if (smartAction === 'heal') {
      // Republish approved/final slots whose smart_generated_campaigns row is
      // missing (e.g. after a table wipe/reset) so /lp/:id resolves again. The
      // rebuild is DETERMINISTIC (idFor = sha1(entry)) so it lands under the id the
      // slot already advertises, and runs offline (noLLM template) so it works even
      // when LLM/image providers are down. Idempotent + orphan-only + cheap, so it
      // carries the same OPEN posture as preview/sync-daily (no CRON_SECRET); it is
      // a no-op when there are no orphans. Batched + resumable via `remaining`.
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const batchSize = Math.max(1, Math.min(40, +((body && body.batchSize) || req.query?.batchSize || 20)));
      const result = await plan.healOrphans({ config: (body && body.config) || {}, batchSize });
      return res.status(200).json({ ok: true, heal: true, ...result });
    }

    if (smartAction === 'cron') {
      // Vercel Cron sends GET with Authorization: Bearer <CRON_SECRET> when the env var is set.
      const secret = process.env.CRON_SECRET || '';
      const auth = req.headers.authorization || '';
      // With a secret: require Bearer/secret (no spoofable x-vercel-cron trust).
      // Without a secret: open in dev/preview, FAIL CLOSED in production.
      const authorized = secret
        ? (auth === `Bearer ${secret}` || req.query?.secret === secret)
        : (String(process.env.VERCEL_ENV) !== 'production');
      if (!authorized) return res.status(401).json({ ok: false, error: 'Unauthorized cron call' });
      const result = await plan.syncDaily({ persist: true });
      // Kick the background prebuild chain so the full 90-day window keeps its
      // assets (copy + images) prebuilt automatically every day.
      const f = await firePrebuild(0);
      return res.status(200).json({ ok: true, cron: true, synced_at: result.synced_at, mode: result.mode, changes: result.changes.length, persistence: result.persistence, prebuild_kicked: f.fired });
    }

    if (smartAction === 'preview') {
      // Generate-on-demand funnel preview for ANY slot (incl. tentative) without
      // persisting or approving — reviewers see the mailer/ads/LP before sign-off.
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.id && !body.entry) return res.status(400).json({ ok: false, error: 'id (calendar entry) or entry is required' });
      const result = await plan.previewEntry({ id: body.id, entry: body.entry || null, reviewer: body.reviewer || null, config: body.config || {} });
      return res.status(200).json(result);
    }

    if (smartAction === 'approve') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.id && !body.entry) return res.status(400).json({ ok: false, error: 'id (calendar entry) or entry is required' });
      const result = await plan.approveEntry({ id: body.id, entry: body.entry || null, reviewer: body.reviewer || null, config: body.config || {} });
      return res.status(200).json(result);
    }

    if (smartAction === 'reject') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.id) return res.status(400).json({ ok: false, error: 'id is required' });
      const result = await plan.rejectEntry({ id: body.id, reviewer: body.reviewer || null, notes: body.notes || '', config: body.config || {} });
      return res.status(200).json(result);
    }

    if (smartAction === 'unreject') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.id) return res.status(400).json({ ok: false, error: 'id is required' });
      const result = await plan.unrejectEntry({ id: body.id, reviewer: body.reviewer || null, config: body.config || {} });
      return res.status(200).json(result);
    }

    if (smartAction === 'activate-scenario') {
      // Promote a pre-staged standby scenario (best|conservative|emergency|instant)
      // into the active rolling plan, or revert with scenario='medium'.
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.scenario) return res.status(400).json({ ok: false, error: 'scenario is required (best|medium|conservative|emergency|instant)' });
      const result = await plan.activateScenario({ scenario: body.scenario, reviewer: body.reviewer || null, scope: body.scope || 'all', config: body.config || {} });
      return res.status(200).json(result);
    }

    if (smartAction === 'run-daily' || smartAction === 'daily') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const result = await runDailySmartBrain({ config: body.config || {}, startDate: body.start_date, days: body.days, persist: body.persist === true });
      return res.status(200).json(result);
    }

    if (smartAction === 'generate-slot') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.entry) return res.status(400).json({ ok: false, error: 'entry is required' });
      const campaign = new GenerationService(smartConfig(body.config || {})).generate(body.entry);
      return res.status(200).json({ ok: true, campaign });
    }

    if (smartAction === 'feedback') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const config = smartConfig(body.config || {});
      const db = new SmartBrainDbAdapter(config);
      const feedback = { target_type: body.target_type || 'calendar_entry', target_id: body.target_id, verdict: body.verdict || 'comment', notes: body.notes || '', reviewer: body.reviewer || null, created_at: new Date().toISOString() };
      const persistence = await db.insert(config.tableNames.feedback, [feedback]);
      return res.status(200).json({ ok: true, feedback, persistence, applied_to_future_generation: true });
    }

    if (smartAction === 'weekly-recalibration' || smartAction === 'recalibrate') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const result = await runDailySmartBrain({ config: body.config || {}, startDate: body.start_date, days: body.days || 15, persist: body.persist === true });
      result.weekly_recalibration = { completed_at: new Date().toISOString(), human_reviewer: body.reviewer || 'unassigned', decisions: body.decisions || [], next_required_by_days: 7 };
      return res.status(200).json(result);
    }

    return res.status(400).json({ ok: false, error: 'Unknown Smart Brain action. Use smart-brain-health|smart-brain-schema|smart-brain-plan|smart-brain-sync-daily|smart-brain-cron|smart-brain-prebuild|smart-brain-heal|smart-brain-preview|smart-brain-approve|smart-brain-reject|smart-brain-run-daily|smart-brain-generate-slot|smart-brain-feedback|smart-brain-weekly-recalibration' });
  } catch (err) {
    console.error('[api/calendar smart-brain]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function lifecycle(req, res, action) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const body = readBody(req);
  // Declared for the whole function. It used to be declared INSIDE the
  // lifecycle-list branch, so lifecycle-build-mailer's `(q && q.force)` was a
  // ReferenceError on every request that did not already carry force:true —
  // caught by the try below and answered as a 500 reading "q is not defined".
  const q = req.query || {};
  try {
    if (action === 'lifecycle-generate') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const result = await lifecycleGen.generateLifecycleCalendar({
        start_date: body.start_date,
        days: body.days,
        cohorts: body.cohorts,
        cadence_per_week: body.cadence_per_week,
        market: body.market || 'UK',
      });
      return res.status(200).json({ ok: true, ...result });
    }

    if (action === 'lifecycle-list') {
      const result = await lifecycleGen.listEntries({
        market: q.market || body.market || 'UK',
        from: q.from || body.from || null,
        to: q.to || body.to || null,
      });
      return res.status(200).json(result);
    }

    if (action === 'lifecycle-build-mailer') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.id && !body.entry) return res.status(400).json({ ok: false, error: 'id (lifecycle entry) or entry is required' });
      const result = await lifecycleBuild.buildLifecycleMailer({ id: body.id || null, entry: body.entry || null, force: flag(body.force) || flag(q.force) });
      return res.status(200).json(result);
    }

    return res.status(400).json({ ok: false, error: 'Unknown lifecycle action. Use lifecycle-generate|lifecycle-list|lifecycle-build-mailer' });
  } catch (err) {
    console.error('[api/calendar lifecycle]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = async function handler(req, res) {
  const action = (req.query?.action || '').toLowerCase();
  if (action === 'generate') return generate(req, res);
  if (action === 'trigger-mailer' || action === 'triggermailer') return triggerMailer(req, res);
  // Connector pre-flight for the smart-brain generateAll pipeline. Multiplexed
  // here (not a new function file) to stay under Vercel Hobby's 12-function cap.
  if (action === 'connectors-check') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    try {
      const { checkTextProviders } = require('./_shared/connector-check.js');
      const userGeminiKey =
        (req.headers && (req.headers['x-gemini-key'] || req.headers['x-user-gemini-key'])) ||
        (req.query && req.query.geminiKey) || '';
      return res.status(200).json({ ok: true, ...checkTextProviders({ userGeminiKey }) });
    } catch (_) {
      return res.status(200).json({ ok: false, anyConfigured: false, anyUsable: false, providers: [], summary: 'Could not run connector diagnostics.' });
    }
  }
  if (action.startsWith('lifecycle-')) return lifecycle(req, res, action);
  if (action.startsWith('smart-brain-')) return smartBrain(req, res, action.replace('smart-brain-', ''));
  if (action === 'lp') {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      const id = String(req.query?.id || '');
      const { html, diag } = await plan.landingPageResolve(id, {}, req.query?.v || null);
      // ?debug=1 → JSON diagnostics (no secrets) so a 404 is diagnosable live.
      if (req.query?.debug) { res.setHeader('Content-Type', 'application/json'); return res.status(200).json({ ok: true, diag }); }
      if (!html) {
        // NEVER serve a dead page. The /lp URL always hosts a REAL, on-brand KNICKGASM
        // landing page: the campaign's own if persisted (any generated campaign,
        // not just approved ones — landingPageResolve is not approval-gated), else a
        // complete catalog-driven fallback so a link minted before persistence still
        // resolves to a real page. ?debug=1 above still exposes the diag.
        const region = String(req.query?.region || req.query?.r || 'us').toLowerCase();
        const { buildFallbackLanding, brandForLandingRecord } = require('./_shared/landing-fallback.js');
        // WHOSE brand the fallback wears is decided by the RECORD the id
        // resolved to - the smart_generated_campaigns row, the landing page
        // mirror, or the calendar slot that advertises the id - never by the
        // link. An ordinary /lp/<id> link carries no workspace_id (that is how
        // smart-brain-plan.js and smart-brain.html mint them), and reading one
        // off the query would let any link name any brand. With no record
        // there is nobody to attribute the page to, so it renders NEUTRAL with
        // a DATA REQUIRED marker; the shipped default brand is used only when
        // the record itself is tenant zero's. (An earlier version read
        // `body.config.workspace_id` here, and `body` is declared only inside
        // smartBrain() and lifecycle(), so the ReferenceError was swallowed by
        // the catch below and the page always rendered with no brand.)
        const env = { url: (process.env.SUPABASE_URL || '').replace(/\/$/, ''), key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '' };
        const owner = await brandForLandingRecord(env, diag.workspace_id);
        const fb = buildFallbackLanding({ id, region, hint: String(req.query?.hint || ''), brand: owner.brand, attribution: owner });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-KNICKGASM-LP', diag.campaignFound ? 'campaign-no-lp-fallback' : 'campaign-not-persisted-fallback');
        if (req.query?.download) {
          res.setHeader('Content-Disposition', `attachment; filename="knickgasm-lp-${(id || 'page').replace(/[^a-z0-9_-]/gi, '')}.html"`);
          res.setHeader('Cache-Control', 'no-store');
          return res.status(200).send(fb);
        }
        res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=300');
        return res.status(200).send(fb);
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // ?download=1 → export the self-contained, deploy-ready HTML file (drop onto try.knickgasm.*).
      if (req.query?.download) {
        res.setHeader('Content-Disposition', `attachment; filename="knickgasm-lp-${(id || 'page').replace(/[^a-z0-9_-]/gi, '')}.html"`);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(html);
      }
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
      return res.status(200).send(html);
    } catch (err) {
      console.error('[api/calendar lp]', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(400).json({ ok: false, error: 'Use ?action=generate, ?action=trigger-mailer, ?action=lp&id=…, ?action=smart-brain-run-daily, or ?action=lifecycle-generate|lifecycle-list|lifecycle-build-mailer' });
};

// ── Metering (Universal Brand Platform) ────────────────────────────────────
// Only the generating actions cost credits; reads, the /lp/:id page server and
// the cron-driven paths stay free. A cron call carries CRON_SECRET rather than
// a user session, and has no wallet to charge, so it is never metered.
const _credits = require('./_shared/credits-core.js');
const _CAL_FEATURE = {
  generate: 'calendar.generate',
  'lifecycle-generate': 'calendar.generate',
  'lifecycle-build-mailer': 'mailer.generate',
  'trigger-mailer': 'mailer.generate',
  triggermailer: 'mailer.generate',
};
module.exports = _credits.metered(module.exports, (req) => {
  const auth = String((req.headers && req.headers.authorization) || '');
  const secret = String(process.env.CRON_SECRET || '');
  if (secret && auth === `Bearer ${secret}`) return null;      // scheduled run
  const action = String((req.query || {}).action || '').toLowerCase();
  return _CAL_FEATURE[action] || null;
});

// Everything this handler calls runs inside the request scope, so llm.js can
// resolve THIS caller's workspace model routing and keys without every one of
// the hundred-odd call sites having to pass `req` down to it. See
// api/_shared/request-scope.js for why an ambient variable would not do.
module.exports = require('./_shared/request-scope.js').wrap(module.exports);
